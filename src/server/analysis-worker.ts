import "server-only";

import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { and, eq, inArray } from "drizzle-orm";

import { appDb, sqliteDb } from "@/server/db/client";
import { analysisFindings, analysisJobs, captureSessions, captureTags, captureTranscripts } from "@/server/db/schema";
import { projectAssetPath, projectRuntimePath, projectScriptPath } from "@/server/project-paths";
import { captureAbsolutePath } from "@/server/storage";

const execFileAsync = promisify(execFile);

export const AUDIO_ANALYSIS_ENGINE = "yamnet-vad";
const AUDIO_ANALYSIS_ENGINE_FAMILY = ["yamnet-litert", "yamnet-vad"] as const;

const AI_PYTHON_PATH = projectRuntimePath("ai-venv", "bin", "python");
const AI_SCRIPT_PATH = projectScriptPath("ai", "audio_tagger.py");
const AI_MODEL_PATH = projectAssetPath("ai", "yamnet.tflite");
const AI_LABELS_PATH = projectAssetPath("ai", "yamnet_class_map.csv");

const WORKER_IDLE_MS = 2_500;
const BACKFILL_INTERVAL_MS = 30_000;
const RUNTIME_CHECK_INTERVAL_MS = 30_000;

type RuntimeCheckState = {
  ok: boolean;
  checkedAtMs: number;
  errorText: string;
};

type PendingJobRow = {
  id: string;
  captureSessionId: string;
  audioRelativePath: string;
};

type TaggerPayload = {
  status: "completed" | "failed";
  class: string;
  subclass: string;
  confidence: number;
  model: string;
  error: string;
  audio_seconds: number;
  rms: number;
  scene_label: string;
  scene_score: number;
  explanation: string;
  voice_activity: {
    detected: boolean;
    ratio: number;
    seconds: number;
    longest_burst_seconds: number;
    confidence: number;
    detector: string;
  };
  top_labels: Array<{
    label: string;
    score: number;
  }>;
};

function parseTaggerPayloadText(raw: string): TaggerPayload | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = lines.at(-1);
  if (!lastLine) {
    return null;
  }

  try {
    return JSON.parse(lastLine) as TaggerPayload;
  } catch {
    return null;
  }
}

type AnalysisWorkerState = {
  running: boolean;
  timer: NodeJS.Timeout | null;
  processing: boolean;
  lastBackfillAtMs: number;
  runtimeCheck: RuntimeCheckState | null;
};

declare global {
  var __hackrfWebUiAnalysisWorker: AnalysisWorkerState | undefined;
}

const workerState: AnalysisWorkerState = global.__hackrfWebUiAnalysisWorker ?? {
  running: false,
  timer: null,
  processing: false,
  lastBackfillAtMs: 0,
  runtimeCheck: null,
};

if (process.env.NODE_ENV !== "production") {
  global.__hackrfWebUiAnalysisWorker = workerState;
}

function analysisRuntimePathsReady(): boolean {
  return (
    existsSync(AI_PYTHON_PATH)
    && existsSync(AI_SCRIPT_PATH)
    && existsSync(AI_MODEL_PATH)
    && existsSync(AI_LABELS_PATH)
  );
}

async function checkAnalysisRuntime(force = false): Promise<RuntimeCheckState> {
  if (!analysisRuntimePathsReady()) {
    return {
      ok: false,
      checkedAtMs: Date.now(),
      errorText: "Local AI runtime is not installed yet.",
    };
  }

  if (!force && workerState.runtimeCheck && Date.now() - workerState.runtimeCheck.checkedAtMs < RUNTIME_CHECK_INTERVAL_MS) {
    return workerState.runtimeCheck;
  }

  try {
    const result = await execFileAsync(
      AI_PYTHON_PATH,
      [AI_SCRIPT_PATH, "--check", "--model", AI_MODEL_PATH, "--labels", AI_LABELS_PATH],
      {
        timeout: 20_000,
        env: {
          ...process.env,
          PYTHONNOUSERSITE: "1",
        },
      },
    );
    const payload = parseTaggerPayloadText(String(result.stdout || "")) as { status?: string; model?: string } | null;
    const nextState = {
      ok: payload?.status === "ok",
      checkedAtMs: Date.now(),
      errorText: payload?.status === "ok" ? "" : "AI runtime check failed.",
    };
    workerState.runtimeCheck = nextState;
    return nextState;
  } catch (error) {
    const stdout = typeof error === "object" && error && "stdout" in error ? String(error.stdout ?? "") : "";
    const payload = parseTaggerPayloadText(stdout);
    const nextState = {
      ok: false,
      checkedAtMs: Date.now(),
      errorText: payload?.error || (error instanceof Error ? error.message : "AI runtime check failed."),
    };
    workerState.runtimeCheck = nextState;
    return nextState;
  }
}

function scheduleWorker(delayMs = WORKER_IDLE_MS): void {
  if (!workerState.running || workerState.timer) {
    return;
  }

  workerState.timer = setTimeout(() => {
    workerState.timer = null;
    void processWorkerTick();
  }, Math.max(250, delayMs));
}

function normalizeAudioClass(value: string): "speech" | "music" | "noise" | "unknown" {
  if (value === "speech" || value === "music" || value === "noise") {
    return value;
  }
  return "unknown";
}

function lookupBurstEventId(captureSessionId: string): string | null {
  const row = appDb
    .select({
      burstEventId: captureSessions.burstEventId,
    })
    .from(captureSessions)
    .where(eq(captureSessions.id, captureSessionId))
    .limit(1)
    .get();

  return row?.burstEventId ?? null;
}

function queueQueuedJob(captureSessionId: string, burstEventIdHint: string | null = null): void {
  const nowMs = Date.now();
  const burstEventId = burstEventIdHint ?? lookupBurstEventId(captureSessionId);
  const existing = appDb
    .select({
      id: analysisJobs.id,
      status: analysisJobs.status,
      burstEventId: analysisJobs.burstEventId,
    })
    .from(analysisJobs)
    .where(
      and(
        eq(analysisJobs.captureSessionId, captureSessionId),
        eq(analysisJobs.engine, AUDIO_ANALYSIS_ENGINE),
      ),
    )
    .limit(1)
    .get();

  if (existing) {
    if (existing.status === "failed") {
      appDb.update(analysisJobs).set({
        status: "queued",
        burstEventId,
        errorText: null,
        startedAtMs: null,
        endedAtMs: null,
      }).where(eq(analysisJobs.id, existing.id)).run();
    } else if (existing.burstEventId !== burstEventId) {
      appDb.update(analysisJobs).set({
        burstEventId,
      }).where(eq(analysisJobs.id, existing.id)).run();
    }
    return;
  }

  appDb
    .insert(analysisJobs)
    .values({
      id: randomUUID(),
      captureSessionId,
      burstEventId,
      engine: AUDIO_ANALYSIS_ENGINE,
      status: "queued",
      paramsJson: JSON.stringify({
        model: path.basename(AI_MODEL_PATH),
        labels: path.basename(AI_LABELS_PATH),
      }),
      errorText: null,
      startedAtMs: null,
      endedAtMs: null,
      createdAtMs: nowMs,
    })
    .run();
}

function captureHasPreferredAnalysisJob(captureSessionId: string): boolean {
  const row = appDb
    .select({
      id: analysisJobs.id,
      status: analysisJobs.status,
    })
    .from(analysisJobs)
    .where(
      and(
        eq(analysisJobs.captureSessionId, captureSessionId),
        eq(analysisJobs.engine, AUDIO_ANALYSIS_ENGINE),
      ),
    )
    .limit(1)
    .get();

  return Boolean(row && row.status !== "failed");
}

function backfillQueuedJobs(limit = 48): number {
  const rows = sqliteDb
    .prepare(
      `
        SELECT cs.id AS captureSessionId
        FROM capture_sessions cs
        INNER JOIN capture_files cf
          ON cf.capture_session_id = cs.id
         AND cf.kind = 'audio'
        LEFT JOIN analysis_jobs aj
          ON aj.capture_session_id = cs.id
         AND aj.engine = ?
        WHERE cs.module IN ('pmr', 'airband', 'maritime')
          AND (aj.id IS NULL OR aj.status = 'failed')
        ORDER BY cs.started_at_ms DESC
        LIMIT ?
      `,
    )
    .all(AUDIO_ANALYSIS_ENGINE, limit) as Array<{ captureSessionId: string }>;

  for (const row of rows) {
    queueQueuedJob(row.captureSessionId);
  }

  return rows.length;
}

function claimNextJob(): PendingJobRow | null {
  const claim = sqliteDb.transaction(() => {
    const row = sqliteDb
      .prepare(
        `
          SELECT
            aj.id AS id,
            aj.capture_session_id AS captureSessionId,
            cf.relative_path AS audioRelativePath
          FROM analysis_jobs aj
          INNER JOIN capture_files cf
            ON cf.capture_session_id = aj.capture_session_id
           AND cf.kind = 'audio'
          WHERE aj.engine = ?
            AND aj.status = 'queued'
          ORDER BY aj.created_at_ms ASC
          LIMIT 1
        `,
      )
      .get(AUDIO_ANALYSIS_ENGINE) as PendingJobRow | undefined;

    if (!row) {
      return null;
    }

    const update = sqliteDb
      .prepare(
        `
          UPDATE analysis_jobs
          SET status = 'running',
              started_at_ms = ?,
              ended_at_ms = NULL,
              error_text = NULL
          WHERE id = ?
            AND status = 'queued'
        `,
      )
      .run(Date.now(), row.id);

    if (update.changes !== 1) {
      return null;
    }

    return row;
  }).immediate;

  return claim();
}

async function runAudioTagger(audioPath: string): Promise<TaggerPayload> {
  try {
    const result = await execFileAsync(
      AI_PYTHON_PATH,
      [AI_SCRIPT_PATH, "--wav", audioPath, "--model", AI_MODEL_PATH, "--labels", AI_LABELS_PATH],
      {
        timeout: 40_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          PYTHONNOUSERSITE: "1",
        },
      },
    );
    const payload = parseTaggerPayloadText(String(result.stdout || ""));
    if (!payload) {
      throw new Error("AI tagger returned invalid JSON.");
    }
    return payload;
  } catch (error) {
    const stdout = typeof error === "object" && error && "stdout" in error ? String(error.stdout ?? "") : "";
    const payload = parseTaggerPayloadText(stdout);
    if (payload) {
      return payload;
    }
    throw error;
  }
}

function writeSuccessfulJob(job: PendingJobRow, payload: TaggerPayload): void {
  const nowMs = Date.now();
  const broadClass = normalizeAudioClass(payload.class);
  const legacyJobs = appDb
    .select({
      id: analysisJobs.id,
    })
    .from(analysisJobs)
    .where(
      and(
        eq(analysisJobs.captureSessionId, job.captureSessionId),
        inArray(analysisJobs.engine, [...AUDIO_ANALYSIS_ENGINE_FAMILY]),
      ),
    )
    .all()
    .filter((row) => row.id !== job.id)
    .map((row) => row.id);

  const commit = sqliteDb.transaction(() => {
    appDb
      .update(analysisJobs)
      .set({
        status: payload.status,
        errorText: payload.error || null,
        endedAtMs: nowMs,
      })
      .where(eq(analysisJobs.id, job.id))
      .run();

    appDb.delete(analysisFindings).where(eq(analysisFindings.analysisJobId, job.id)).run();
    appDb
      .delete(captureTags)
      .where(
        and(
          eq(captureTags.captureSessionId, job.captureSessionId),
          inArray(captureTags.source, [...AUDIO_ANALYSIS_ENGINE_FAMILY]),
        ),
      )
      .run();
    appDb
      .delete(captureTranscripts)
      .where(
        and(
          eq(captureTranscripts.captureSessionId, job.captureSessionId),
          inArray(captureTranscripts.engine, [...AUDIO_ANALYSIS_ENGINE_FAMILY]),
        ),
      )
      .run();
    if (legacyJobs.length > 0) {
      appDb.delete(analysisFindings).where(inArray(analysisFindings.analysisJobId, legacyJobs)).run();
      appDb.delete(analysisJobs).where(inArray(analysisJobs.id, legacyJobs)).run();
    }

    const findings: Array<typeof analysisFindings.$inferInsert> = [
      {
        id: randomUUID(),
        analysisJobId: job.id,
        kind: "classification",
        score: payload.confidence,
        startMs: 0,
        endMs: Math.round((payload.audio_seconds || 0) * 1000),
        dataJson: JSON.stringify({
          class: broadClass,
          subclass: payload.subclass || "",
          confidence: payload.confidence,
          model: payload.model,
          audioSeconds: payload.audio_seconds,
          rms: payload.rms,
          sceneLabel: payload.scene_label || "",
          sceneConfidence: payload.scene_score || 0,
          voiceDetected: Boolean(payload.voice_activity?.detected),
          voiceConfidence: payload.voice_activity?.confidence || 0,
          voiceRatio: payload.voice_activity?.ratio || 0,
          voiceSeconds: payload.voice_activity?.seconds || 0,
          voiceDetector: payload.voice_activity?.detector || "",
          explanation: payload.explanation || "",
        }),
        createdAtMs: nowMs,
      },
    ];
    if (payload.scene_label) {
      findings.push({
        id: randomUUID(),
        analysisJobId: job.id,
        kind: "scene_label",
        score: payload.scene_score || null,
        startMs: null,
        endMs: null,
        dataJson: JSON.stringify({
          label: payload.scene_label,
        }),
        createdAtMs: nowMs,
      });
    }
    if (payload.voice_activity) {
      findings.push({
        id: randomUUID(),
        analysisJobId: job.id,
        kind: "voice_activity",
        score: payload.voice_activity.confidence || null,
        startMs: 0,
        endMs: Math.round((payload.voice_activity.seconds || 0) * 1000),
        dataJson: JSON.stringify({
          detected: Boolean(payload.voice_activity.detected),
          ratio: payload.voice_activity.ratio || 0,
          seconds: payload.voice_activity.seconds || 0,
          longestBurstSeconds: payload.voice_activity.longest_burst_seconds || 0,
          detector: payload.voice_activity.detector || "",
        }),
        createdAtMs: nowMs,
      });
    }

    for (const item of payload.top_labels ?? []) {
      findings.push({
        id: randomUUID(),
        analysisJobId: job.id,
        kind: "top_label",
        score: item.score,
        startMs: null,
        endMs: null,
        dataJson: JSON.stringify({
          label: item.label,
        }),
        createdAtMs: nowMs,
      });
    }
    if (payload.voice_activity?.detected) {
      appDb
        .insert(captureTags)
        .values({
          id: randomUUID(),
          captureSessionId: job.captureSessionId,
          tag: "voice",
          source: AUDIO_ANALYSIS_ENGINE,
          score: payload.voice_activity.confidence,
          createdAtMs: nowMs,
        })
        .run();
    }

    appDb.insert(analysisFindings).values(findings).run();
    appDb
      .insert(captureTags)
      .values({
        id: randomUUID(),
        captureSessionId: job.captureSessionId,
        tag: broadClass,
        source: AUDIO_ANALYSIS_ENGINE,
        score: payload.confidence,
        createdAtMs: nowMs,
      })
      .run();
  }).immediate;

  commit();
}

function writeFailedJob(jobId: string, message: string): void {
  appDb
    .update(analysisJobs)
    .set({
      status: "failed",
      errorText: message.slice(0, 500),
      endedAtMs: Date.now(),
    })
    .where(eq(analysisJobs.id, jobId))
    .run();
}

async function processWorkerTick(): Promise<void> {
  if (!workerState.running || workerState.processing) {
    return;
  }

  workerState.processing = true;
  try {
    if (Date.now() - workerState.lastBackfillAtMs >= BACKFILL_INTERVAL_MS) {
      backfillQueuedJobs();
      workerState.lastBackfillAtMs = Date.now();
    }

    const runtime = await checkAnalysisRuntime();
    if (!runtime.ok) {
      return;
    }

    const job = claimNextJob();
    if (!job) {
      return;
    }

    const audioAbsolutePath = captureAbsolutePath(job.audioRelativePath);
    if (!audioAbsolutePath || !existsSync(audioAbsolutePath)) {
      writeFailedJob(job.id, "audio capture missing");
      return;
    }

    try {
      const payload = await runAudioTagger(audioAbsolutePath);
      if (payload.status === "completed") {
        writeSuccessfulJob(job, payload);
      } else {
        writeFailedJob(job.id, payload.error || "analysis failed");
      }
    } catch (error) {
      try {
        writeFailedJob(job.id, error instanceof Error ? error.message : "analysis failed");
      } catch (writeErr) {
        console.error("[analysis-worker] Failed to write failed job:", writeErr);
      }
    }
  } catch (err) {
    console.error("[analysis-worker] Worker tick error:", err);
  } finally {
    workerState.processing = false;
    scheduleWorker();
  }
}

export function ensureAnalysisWorkerStarted(): void {
  if (workerState.running) {
    scheduleWorker(150);
    return;
  }

  workerState.running = true;
  scheduleWorker(500);
}

export function queueCaptureAnalysisJob(captureSessionId: string, burstEventId: string | null = null): void {
  queueQueuedJob(captureSessionId, burstEventId);
  ensureAnalysisWorkerStarted();
}

export function ensureCaptureAnalysisUpToDate(captureSessionId: string): void {
  if (captureHasPreferredAnalysisJob(captureSessionId)) {
    ensureAnalysisWorkerStarted();
    return;
  }

  queueQueuedJob(captureSessionId);
  ensureAnalysisWorkerStarted();
}

export function warmAnalysisBackfill(): void {
  backfillQueuedJobs();
  ensureAnalysisWorkerStarted();
}
