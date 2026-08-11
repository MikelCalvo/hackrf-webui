import assert from "node:assert/strict";
import test from "node:test";

import Database from "better-sqlite3";

import { DEFAULT_APP_SETTINGS, SETTINGS_STORAGE_KEYS } from "@/lib/settings";
import {
  AI_QUEUE_POLICY_KEY,
  claimNextEligibleAnalysisJob,
  countAnalysisJobs,
  queueAnalysisJobIfEnabled,
  readAiQueuePolicy,
  writeAiQueuePolicy,
} from "@/server/settings-policy";

const ENGINE = "sigint-audio-v2";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value_json TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE TABLE capture_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      module TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE capture_files (
      id TEXT PRIMARY KEY NOT NULL,
      capture_session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      relative_path TEXT NOT NULL
    );
    CREATE TABLE analysis_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      capture_session_id TEXT NOT NULL,
      burst_event_id TEXT,
      engine TEXT NOT NULL,
      status TEXT NOT NULL,
      params_json TEXT NOT NULL,
      error_text TEXT,
      started_at_ms INTEGER,
      ended_at_ms INTEGER,
      created_at_ms INTEGER NOT NULL,
      UNIQUE(capture_session_id, engine)
    );
  `);
  return db;
}

function setAi(db: Database.Database, patch: Partial<typeof DEFAULT_APP_SETTINGS.ai>): void {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value_json, updated_at_ms) VALUES (?, ?, 1)")
    .run(SETTINGS_STORAGE_KEYS.ai, JSON.stringify({ ...DEFAULT_APP_SETTINGS.ai, ...patch }));
}

function addCapture(db: Database.Database, id: string, module = "pmr"): void {
  db.prepare("INSERT INTO capture_sessions (id, module, started_at_ms) VALUES (?, ?, ?)").run(id, module, 10);
  db.prepare("INSERT INTO capture_files (id, capture_session_id, kind, relative_path) VALUES (?, ?, 'audio', ?)")
    .run(`file-${id}`, id, `${id}.wav`);
}

function addQueuedJob(db: Database.Database, id: string, captureId: string, createdAtMs: number): void {
  db.prepare(`
    INSERT INTO analysis_jobs
      (id, capture_session_id, burst_event_id, engine, status, params_json, created_at_ms)
    VALUES (?, ?, NULL, ?, 'queued', '{}', ?)
  `).run(id, captureId, ENGINE, createdAtMs);
}

test("disabled AI does not queue a new capture", () => {
  const db = makeDb();
  setAi(db, { enabled: false });
  addCapture(db, "capture-disabled");

  const queued = queueAnalysisJobIfEnabled(db, {
    captureSessionId: "capture-disabled",
    burstEventId: null,
    engine: ENGINE,
    paramsJson: "{}",
  });

  assert.equal(queued, false);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM analysis_jobs").get() as { count: number }).count, 0);
  db.close();
});

test("module allowlist prevents speech analysis for MORSE evidence", () => {
  const db = makeDb();
  setAi(db, { enabled: true, modules: ["pmr"] });
  addCapture(db, "capture-morse", "morse");

  assert.equal(queueAnalysisJobIfEnabled(db, {
    captureSessionId: "capture-morse",
    burstEventId: null,
    engine: ENGINE,
    paramsJson: "{}",
  }), false);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM analysis_jobs").get() as { count: number }).count, 0);
  db.close();
});

test("queue creation preserves its original timestamp for backlog eligibility", () => {
  const db = makeDb();
  setAi(db, { enabled: true, modules: ["pmr"] });
  addCapture(db, "capture-new");

  assert.equal(queueAnalysisJobIfEnabled(db, {
    captureSessionId: "capture-new",
    burstEventId: "burst-1",
    engine: ENGINE,
    paramsJson: '{"cpuThreads":4}',
    createdAtMs: 1234,
  }), true);

  const row = db.prepare("SELECT status, created_at_ms AS createdAtMs, params_json AS paramsJson FROM analysis_jobs").get() as {
    status: string;
    createdAtMs: number;
    paramsJson: string;
  };
  assert.deepEqual(row, { status: "queued", createdAtMs: 1234, paramsJson: '{"cpuThreads":4}' });
  db.close();
});

test("claim boundary keeps historical queued jobs held after enable", () => {
  const db = makeDb();
  addCapture(db, "old-capture");
  addCapture(db, "new-capture");
  addQueuedJob(db, "old-job", "old-capture", 99);
  addQueuedJob(db, "new-job", "new-capture", 100);
  writeAiQueuePolicy(db, { version: 1, claimQueuedAfterMs: 100 }, 110);

  const claimed = claimNextEligibleAnalysisJob(db, ENGINE);

  assert.equal(claimed?.id, "new-job");
  const rows = db.prepare("SELECT id, status FROM analysis_jobs ORDER BY id").all() as Array<{ id: string; status: string }>;
  assert.deepEqual(rows, [
    { id: "new-job", status: "running" },
    { id: "old-job", status: "queued" },
  ]);
  db.close();
});

test("claim boundary is inclusive for jobs created at enable time", () => {
  const db = makeDb();
  addCapture(db, "capture-equal");
  addQueuedJob(db, "job-equal", "capture-equal", 500);
  writeAiQueuePolicy(db, { version: 1, claimQueuedAfterMs: 500 });

  assert.equal(claimNextEligibleAnalysisJob(db, ENGINE)?.id, "job-equal");
  db.close();
});

test("queue counters distinguish held backlog from newly eligible jobs", () => {
  const db = makeDb();
  addCapture(db, "old-capture");
  addCapture(db, "new-capture");
  addQueuedJob(db, "old-job", "old-capture", 9);
  addQueuedJob(db, "new-job", "new-capture", 10);
  writeAiQueuePolicy(db, { version: 1, claimQueuedAfterMs: 10 });

  assert.deepEqual(countAnalysisJobs(db, ENGINE), {
    queuedJobs: 2,
    heldQueuedJobs: 1,
    runningJobs: 0,
  });
  db.close();
});

test("corrupt queue policy falls back to the safe legacy boundary", () => {
  const db = makeDb();
  db.prepare("INSERT INTO app_settings (key, value_json, updated_at_ms) VALUES (?, ?, 1)")
    .run(AI_QUEUE_POLICY_KEY, "not-json");

  assert.deepEqual(readAiQueuePolicy(db), { version: 1, claimQueuedAfterMs: 0 });
  db.close();
});

test("failed jobs are requeued without changing their original creation boundary", () => {
  const db = makeDb();
  setAi(db, { enabled: true, modules: ["pmr"] });
  addCapture(db, "capture-failed");
  db.prepare(`
    INSERT INTO analysis_jobs
      (id, capture_session_id, burst_event_id, engine, status, params_json, error_text, started_at_ms, ended_at_ms, created_at_ms)
    VALUES ('failed-job', 'capture-failed', NULL, ?, 'failed', '{}', 'bad', 2, 3, 42)
  `).run(ENGINE);

  assert.equal(queueAnalysisJobIfEnabled(db, {
    captureSessionId: "capture-failed",
    burstEventId: "burst-new",
    engine: ENGINE,
    paramsJson: '{"cpuThreads":2}',
    createdAtMs: 999,
  }), true);

  const row = db.prepare("SELECT status, created_at_ms AS createdAtMs, params_json AS paramsJson, error_text AS errorText FROM analysis_jobs").get() as {
    status: string;
    createdAtMs: number;
    paramsJson: string;
    errorText: string | null;
  };
  assert.deepEqual(row, {
    status: "queued",
    createdAtMs: 42,
    paramsJson: '{"cpuThreads":2}',
    errorText: null,
  });
  db.close();
});

test("an existing queued job can update the burst association without duplication", () => {
  const db = makeDb();
  setAi(db, { enabled: true, modules: ["pmr"] });
  addCapture(db, "capture-existing");
  addQueuedJob(db, "existing-job", "capture-existing", 7);

  assert.equal(queueAnalysisJobIfEnabled(db, {
    captureSessionId: "capture-existing",
    burstEventId: "burst-late",
    engine: ENGINE,
    paramsJson: "{}",
  }), true);

  const row = db.prepare("SELECT COUNT(*) AS count, burst_event_id AS burstEventId FROM analysis_jobs").get() as {
    count: number;
    burstEventId: string | null;
  };
  assert.deepEqual(row, { count: 1, burstEventId: "burst-late" });
  db.close();
});

test("settings policy test sentinel", () => assert.equal(true, true));
