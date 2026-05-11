import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import Database from "better-sqlite3";

const execFileAsync = promisify(execFile);

async function migrate(dbPath: string) {
  return execFileAsync(process.execPath, ["./scripts/db/migrate.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, HACKRF_WEBUI_DB_PATH: dbPath },
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
}

test("db:migrate initializes the schema and is idempotent on a fresh database", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "hackrf-webui-db-test-"));
  const dbPath = path.join(workspace, "app.sqlite");

  try {
    const first = await migrate(dbPath);
    assert.match(first.stdout, /applied 0000_initial\.sql/);
    assert.match(first.stdout, /ready at /);

    const sqlite = new Database(dbPath, { readonly: true });
    try {
      const tableNames = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC")
        .all()
        .map((row) => (row as { name: string }).name);
      assert.deepEqual(
        [
          "__app_migrations",
          "activity_events",
          "adsb_track_points",
          "ais_track_points",
          "analysis_findings",
          "analysis_jobs",
          "app_settings",
          "burst_events",
          "capture_files",
          "capture_reviews",
          "capture_sessions",
          "capture_tags",
          "capture_transcripts",
          "scan_runs",
        ].every((name) => tableNames.includes(name)),
        true,
      );

      const migrationCount = sqlite
        .prepare("SELECT COUNT(*) AS count FROM __app_migrations")
        .get() as { count: number };
      assert.equal(migrationCount.count, 7);
    } finally {
      sqlite.close();
    }

    const second = await migrate(dbPath);
    assert.doesNotMatch(second.stdout, /applied \d{4}_/);
    assert.match(second.stdout, /no new migrations/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
