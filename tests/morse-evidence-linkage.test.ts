import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import Database from "better-sqlite3";

const execFileAsync = promisify(execFile);
type ModuleLoader = (request: string, parent: unknown, isMain: boolean) => unknown;
const moduleWithLoad = Module as typeof Module & { _load: ModuleLoader };
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
  if (request === "server-only") return {};
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

test("MORSE persistence binds the finding to the capture_session WAV/IQ with real hashes", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "hackrf-webui-morse-evidence-"));
  const dbPath = path.join(workspace, "app.sqlite");
  const captureRoot = path.join(process.cwd(), "data", "captures");
  const token = `test-${process.pid}-${Date.now()}`;
  const relativeDir = path.join("tests", token);
  const absoluteDir = path.join(captureRoot, relativeDir);
  const wavPath = path.join(absoluteDir, "activity.wav");
  const iqPath = path.join(absoluteDir, "activity.iq");
  const previousDbPath = process.env.HACKRF_WEBUI_DB_PATH;
  process.env.HACKRF_WEBUI_DB_PATH = dbPath;

  try {
    await prepareDb(dbPath);
    await mkdir(absoluteDir, { recursive: true });
    await writeFile(wavPath, Buffer.from("primary-wav-evidence"));
    await writeFile(iqPath, Buffer.from("primary-iq-evidence"));
    const wavHash = createHash("sha256").update("primary-wav-evidence").digest("hex");
    const iqHash = createHash("sha256").update("primary-iq-evidence").digest("hex");
    const sqlite = new Database(dbPath);
    try {
      const nowMs = Date.now();
      sqlite.prepare(`
        INSERT INTO capture_sessions (id, module, reason, status, started_at_ms, ended_at_ms, freq_hz, demod_mode, created_at_ms, updated_at_ms)
        VALUES (?, 'morse', 'scan-hit', 'completed', ?, ?, ?, 'cw', ?, ?)
      `).run("capture-link", nowMs, nowMs + 1000, 7_040_000, nowMs, nowMs);
      sqlite.prepare(`
        INSERT INTO capture_files (id, capture_session_id, kind, format, relative_path, byte_size, sha256, sample_rate, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("wav-link", "capture-link", "audio", "wav", `${relativeDir}/activity.wav`, null, null, 10_000, nowMs);
      sqlite.prepare(`
        INSERT INTO capture_files (id, capture_session_id, kind, format, relative_path, byte_size, sha256, sample_rate, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("iq-link", "capture-link", "raw_iq", "cs8", `${relativeDir}/activity.iq`, null, null, 2_000_000, nowMs);
    } finally {
      sqlite.close();
    }

    const { bindMorseResultToCaptureEvidence } = await import("@/server/morse-persistence-store");
    const result = await bindMorseResultToCaptureEvidence("capture-link", {
      engine: "morse-timing",
      engineVersion: "1",
      frontEnd: "cw_carrier",
      tunedFrequencyHz: 7_040_000,
      detectedFrequencyHz: null,
      frequencyOffsetHz: null,
      toneHz: 700,
      startedAtMs: 1,
      endedAtMs: 2,
      dotMs: 60,
      wordsPerMinute: 20,
      snrDb: 10,
      noiseFloorDb: -50,
      rawMorse: "... --- ...",
      decodedText: "SOS",
      characters: [],
      confidence: 0.9,
      unresolvedCount: 0,
      expectedIdentifier: null,
      identifierMatch: null,
      catalog: null,
      evidence: { wav: null, iq: null },
    });

    assert.deepEqual(result.evidence, {
      wav: { path: `${relativeDir}/activity.wav`, sha256: wavHash, byteSize: 20 },
      iq: { path: `${relativeDir}/activity.iq`, sha256: iqHash, byteSize: 19 },
    });
    const verifyDb = new Database(dbPath, { readonly: true });
    try {
      const rows = verifyDb.prepare("SELECT kind, sha256, byte_size AS byteSize FROM capture_files WHERE capture_session_id = ? ORDER BY kind").all("capture-link") as Array<{ kind: string; sha256: string | null; byteSize: number | null }>;
      assert.deepEqual(rows, [
        { kind: "audio", sha256: wavHash, byteSize: 20 },
        { kind: "raw_iq", sha256: iqHash, byteSize: 19 },
      ]);
    } finally {
      verifyDb.close();
    }
  } finally {
    if (previousDbPath === undefined) delete process.env.HACKRF_WEBUI_DB_PATH;
    else process.env.HACKRF_WEBUI_DB_PATH = previousDbPath;
    await rm(absoluteDir, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});
