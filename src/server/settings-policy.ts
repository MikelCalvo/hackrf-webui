import type Database from "better-sqlite3";

import {
  DEFAULT_APP_SETTINGS,
  parseStoredSettingsSection,
  SETTINGS_STORAGE_KEYS,
  type AiSettings,
} from "@/lib/settings";

export const AI_QUEUE_POLICY_KEY = "runtime.ai.queue-policy.v1";

export type AiQueuePolicy = {
  version: 1;
  claimQueuedAfterMs: number;
};

export function readAiSettingsFromDatabase(sqlite: Database.Database): AiSettings {
  const row = sqlite.prepare("SELECT value_json AS valueJson FROM app_settings WHERE key = ? LIMIT 1")
    .get(SETTINGS_STORAGE_KEYS.ai) as { valueJson: string } | undefined;
  return row
    ? parseStoredSettingsSection("ai", row.valueJson)
    : { ...DEFAULT_APP_SETTINGS.ai, modules: [...DEFAULT_APP_SETTINGS.ai.modules] };
}

export function readAiQueuePolicy(sqlite: Database.Database): AiQueuePolicy {
  const row = sqlite.prepare("SELECT value_json AS valueJson FROM app_settings WHERE key = ? LIMIT 1")
    .get(AI_QUEUE_POLICY_KEY) as { valueJson: string } | undefined;
  if (!row) return { version: 1, claimQueuedAfterMs: 0 };
  try {
    const parsed = JSON.parse(row.valueJson) as Partial<AiQueuePolicy>;
    return parsed.version === 1
      && typeof parsed.claimQueuedAfterMs === "number"
      && Number.isFinite(parsed.claimQueuedAfterMs)
      && parsed.claimQueuedAfterMs >= 0
      ? { version: 1, claimQueuedAfterMs: parsed.claimQueuedAfterMs }
      : { version: 1, claimQueuedAfterMs: 0 };
  } catch {
    return { version: 1, claimQueuedAfterMs: 0 };
  }
}

export function writeAiQueuePolicy(sqlite: Database.Database, policy: AiQueuePolicy, nowMs = Date.now()): void {
  sqlite.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at_ms)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at_ms = excluded.updated_at_ms
  `).run(AI_QUEUE_POLICY_KEY, JSON.stringify(policy), nowMs);
}

export function claimNextEligibleAnalysisJob(sqlite: Database.Database, engine: string): {
  id: string;
  captureSessionId: string;
  audioRelativePath: string;
} | null {
  const policy = readAiQueuePolicy(sqlite);
  const claim = sqlite.transaction(() => {
    const row = sqlite.prepare(`
      SELECT aj.id AS id, aj.capture_session_id AS captureSessionId, cf.relative_path AS audioRelativePath
      FROM analysis_jobs aj
      INNER JOIN capture_files cf ON cf.capture_session_id = aj.capture_session_id AND cf.kind = 'audio'
      WHERE aj.engine = ? AND aj.status = 'queued' AND aj.created_at_ms >= ?
      ORDER BY aj.created_at_ms ASC
      LIMIT 1
    `).get(engine, policy.claimQueuedAfterMs) as {
      id: string;
      captureSessionId: string;
      audioRelativePath: string;
    } | undefined;
    if (!row) return null;
    const updated = sqlite.prepare(`
      UPDATE analysis_jobs
      SET status = 'running', started_at_ms = ?, ended_at_ms = NULL, error_text = NULL
      WHERE id = ? AND status = 'queued'
    `).run(Date.now(), row.id);
    return updated.changes === 1 ? row : null;
  }).immediate;
  return claim();
}

export function queueAnalysisJobIfEnabled(
  sqlite: Database.Database,
  input: { captureSessionId: string; burstEventId: string | null; engine: string; paramsJson: string; createdAtMs?: number },
): boolean {
  const ai = readAiSettingsFromDatabase(sqlite);
  if (!ai.enabled) return false;
  const capture = sqlite.prepare("SELECT module FROM capture_sessions WHERE id = ? LIMIT 1")
    .get(input.captureSessionId) as { module: string } | undefined;
  if (!capture || !ai.modules.includes(capture.module as AiSettings["modules"][number])) return false;
  const existing = sqlite.prepare("SELECT id, status, burst_event_id AS burstEventId FROM analysis_jobs WHERE capture_session_id = ? AND engine = ? LIMIT 1")
    .get(input.captureSessionId, input.engine) as { id: string; status: string; burstEventId: string | null } | undefined;
  if (existing) {
    if (existing.status === "failed") {
      sqlite.prepare("UPDATE analysis_jobs SET status = 'queued', burst_event_id = ?, params_json = ?, error_text = NULL, started_at_ms = NULL, ended_at_ms = NULL WHERE id = ?")
        .run(input.burstEventId, input.paramsJson, existing.id);
    } else if (existing.burstEventId !== input.burstEventId) {
      sqlite.prepare("UPDATE analysis_jobs SET burst_event_id = ? WHERE id = ?")
        .run(input.burstEventId, existing.id);
    }
    return true;
  }
  sqlite.prepare(`
    INSERT INTO analysis_jobs (id, capture_session_id, burst_event_id, engine, status, params_json, error_text, started_at_ms, ended_at_ms, created_at_ms)
    VALUES (lower(hex(randomblob(16))), ?, ?, ?, 'queued', ?, NULL, NULL, NULL, ?)
  `).run(input.captureSessionId, input.burstEventId, input.engine, input.paramsJson, input.createdAtMs ?? Date.now());
  return true;
}

export function countAnalysisJobs(sqlite: Database.Database, engine: string): {
  queuedJobs: number;
  heldQueuedJobs: number;
  runningJobs: number;
} {
  const policy = readAiQueuePolicy(sqlite);
  const row = sqlite.prepare(`
    SELECT
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queuedJobs,
      SUM(CASE WHEN status = 'queued' AND created_at_ms < ? THEN 1 ELSE 0 END) AS heldQueuedJobs,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS runningJobs
    FROM analysis_jobs
    WHERE engine = ?
  `).get(policy.claimQueuedAfterMs, engine) as { queuedJobs: number | null; heldQueuedJobs: number | null; runningJobs: number | null };
  return { queuedJobs: row.queuedJobs ?? 0, heldQueuedJobs: row.heldQueuedJobs ?? 0, runningJobs: row.runningJobs ?? 0 };
}

export function queueHistoricalAnalysisJobs(sqlite: Database.Database, engine: string, limit = 48): number {
  const ai = readAiSettingsFromDatabase(sqlite);
  if (!ai.enabled || ai.modules.length === 0) return 0;
  const placeholders = ai.modules.map(() => "?").join(", ");
  const rows = sqlite.prepare(`
    SELECT cs.id AS captureSessionId
    FROM capture_sessions cs
    INNER JOIN capture_files cf ON cf.capture_session_id = cs.id AND cf.kind = 'audio'
    LEFT JOIN analysis_jobs aj ON aj.capture_session_id = cs.id AND aj.engine = ?
    WHERE cs.module IN (${placeholders}) AND (aj.id IS NULL OR aj.status = 'failed')
    ORDER BY cs.started_at_ms DESC
    LIMIT ?
  `).all(engine, ...ai.modules, limit) as Array<{ captureSessionId: string }>;
  for (const row of rows) {
    queueAnalysisJobIfEnabled(sqlite, {
      captureSessionId: row.captureSessionId,
      burstEventId: null,
      engine,
      paramsJson: JSON.stringify({ cpuThreads: ai.cpuThreads, hotwordsConfigured: ai.hotwords.length > 0 }),
    });
  }
  return rows.length;
}
