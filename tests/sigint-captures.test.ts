import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import Module from "node:module";
import test from "node:test";

import Database from "better-sqlite3";

const execFileAsync = promisify(execFile);
type ModuleLoader = (request: string, parent: unknown, isMain: boolean) => unknown;
const moduleWithLoad = Module as typeof Module & { _load: ModuleLoader };
const originalLoad = moduleWithLoad._load;

moduleWithLoad._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
  if (request === "server-only") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function prepareDb(dbPath: string): Promise<void> {
  await execFileAsync(process.execPath, ["./scripts/db/migrate.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, HACKRF_WEBUI_DB_PATH: dbPath },
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
}

function seedCapture(dbPath: string, relativePath: string): void {
  const sqlite = new Database(dbPath);
  try {
    const nowMs = Date.UTC(2026, 0, 2, 3, 4, 5);
    sqlite.prepare(`
      INSERT INTO capture_sessions (
        id,
        module,
        reason,
        status,
        started_at_ms,
        freq_hz,
        demod_mode,
        created_at_ms,
        updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("session-1", "sigint", "activity", "completed", nowMs, 145_500_000, "fm", nowMs, nowMs);

    sqlite.prepare(`
      INSERT INTO capture_files (
        id,
        capture_session_id,
        kind,
        format,
        relative_path,
        byte_size,
        created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("file-1", "session-1", "audio", "wav", relativePath, 128, nowMs);
  } finally {
    sqlite.close();
  }
}

test("capture storage rejects path traversal before exposing files", async () => {
  const { captureAbsolutePath } = await import("@/server/storage");

  assert.equal(captureAbsolutePath("../outside.wav"), null);
  assert.equal(captureAbsolutePath("safe/../../outside.wav"), null);
  assert.equal(captureAbsolutePath("safe\\..\\..\\outside.wav"), null);
  assert.match(captureAbsolutePath("2026/01/02/sigint/session-1/audio.wav") ?? "", /data\/captures\/2026\/01\/02\/sigint\/session-1\/audio\.wav$/);
});

test("SIGINT capture summaries do not expose capture file URLs for traversal paths", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "hackrf-webui-sigint-test-"));
  const dbPath = path.join(workspace, "app.sqlite");
  const previousDbPath = process.env.HACKRF_WEBUI_DB_PATH;
  process.env.HACKRF_WEBUI_DB_PATH = dbPath;

  try {
    await prepareDb(dbPath);
    seedCapture(dbPath, "../../outside.wav");

    const { getSigintCaptureDetail, listSigintCaptureSummaries } = await import("@/server/sigint-store");
    const list = listSigintCaptureSummaries({
      module: "all",
      reviewStatus: "all",
      analysis: "all",
      hasAudio: false,
      hasRawIq: false,
      q: "",
      limit: 10,
    });
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].audioCapture, null);

    const detail = getSigintCaptureDetail("session-1");
    assert.ok(detail);
    assert.equal(detail.audioCapture, null);
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.HACKRF_WEBUI_DB_PATH;
    } else {
      process.env.HACKRF_WEBUI_DB_PATH = previousDbPath;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});
