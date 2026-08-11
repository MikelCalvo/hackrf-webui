import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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

function seedMorseCapture(dbPath: string): void {
  const sqlite = new Database(dbPath);
  try {
    const nowMs = Date.UTC(2026, 7, 11, 18, 0, 0);
    sqlite.prepare(`
      INSERT INTO capture_sessions (
        id, module, reason, status, started_at_ms, ended_at_ms, freq_hz,
        demod_mode, metadata_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "morse-capture-1",
      "morse",
      "scan-hit",
      "completed",
      nowMs,
      nowMs + 20_000,
      115_900_000,
      "am",
      JSON.stringify({ label: "BLV Bilbao VOR-DME" }),
      nowMs,
      nowMs,
    );

    sqlite.prepare(`
      INSERT INTO capture_files (
        id, capture_session_id, kind, format, relative_path, byte_size, sha256, sample_rate, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("morse-wav-1", "morse-capture-1", "audio", "wav", "2026/08/11/morse/morse-capture-1/activity.wav", 4096, "wav-hash", 10_000, nowMs);
    sqlite.prepare(`
      INSERT INTO capture_files (
        id, capture_session_id, kind, format, relative_path, byte_size, sha256, sample_rate, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("morse-iq-1", "morse-capture-1", "raw_iq", "cs8", "2026/08/11/morse/morse-capture-1/activity.iq", 8192, "iq-hash", 2_000_000, nowMs);

    sqlite.prepare(`
      INSERT INTO analysis_jobs (
        id, capture_session_id, engine, status, params_json, started_at_ms, ended_at_ms, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "morse-job-1",
      "morse-capture-1",
      "morse-timing@1.0.0",
      "completed",
      JSON.stringify({ contractVersion: 1, frontEnd: "am_tone", toneHz: 1020 }),
      nowMs,
      nowMs + 20_000,
      nowMs,
    );

    const evidence = {
      contractVersion: 1,
      engine: { name: "morse-timing", version: "1.0.0" },
      frontEnd: "am_tone",
      frequency: { tunedHz: 115_900_000, detectedHz: 115_900_015, offsetHz: 15 },
      toneHz: 1020,
      timing: { startMs: nowMs, endMs: nowMs + 20_000, dotMs: 80, wordsPerMinute: 15, elements: [] },
      signal: { snrDb: 12.4, noiseFloorDb: -54.2 },
      rawMorse: "-... .-.. ...-",
      decodedText: "BLV",
      confidence: { overall: 0.93, characters: [], unresolvedCount: 0 },
      identifier: { expected: "BLV", match: true },
      catalog: { source: "ourairports", recordId: "ES-BLV", version: "2026-08-11" },
      evidence: {
        wav: { path: "2026/08/11/morse/morse-capture-1/activity.wav", sha256: "wav-hash", byteSize: 4096 },
        iq: { path: "2026/08/11/morse/morse-capture-1/activity.iq", sha256: "iq-hash", byteSize: 8192 },
      },
    };
    sqlite.prepare(`
      INSERT INTO analysis_findings (
        id, analysis_job_id, kind, score, start_ms, end_ms, data_json, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("morse-finding-1", "morse-job-1", "morse_decode", 0.93, nowMs, nowMs + 20_000, JSON.stringify(evidence), nowMs);
    sqlite.prepare(`
      INSERT INTO capture_transcripts (
        id, capture_session_id, engine, language, text, segments_json, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "morse-transcript-1",
      "morse-capture-1",
      "morse-timing@1.0.0",
      "morse",
      "BLV",
      JSON.stringify({ contractVersion: 1, rawMorse: "-... .-.. ...-", confidence: 0.93, unresolvedCount: 0, characters: [] }),
      nowMs,
    );
    sqlite.prepare(`
      INSERT INTO capture_tags (id, capture_session_id, tag, source, score, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("morse-tag-1", "morse-capture-1", "morse:identifier-match", "morse-timing@1.0.0", 0.93, nowMs);
  } finally {
    sqlite.close();
  }
}

const filters = (q = "") => ({
  module: "all" as const,
  reviewStatus: "all" as const,
  analysis: "all" as const,
  hasAudio: false,
  hasRawIq: false,
  q,
  limit: 20,
});

test("SIGINT exposes complete MORSE review evidence and searches decoded text, raw symbols, and catalog identity", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "hackrf-webui-sigint-morse-"));
  const dbPath = path.join(workspace, "app.sqlite");
  const previousDbPath = process.env.HACKRF_WEBUI_DB_PATH;
  process.env.HACKRF_WEBUI_DB_PATH = dbPath;

  try {
    await prepareDb(dbPath);
    seedMorseCapture(dbPath);
    const {
      getSigintCaptureDetail,
      listSigintCaptureSummaries,
      updateSigintCaptureReview,
    } = await import("@/server/sigint-store");

    for (const query of ["BLV", "-... .-.. ...-", "ourairports", "ES-BLV"]) {
      const result = listSigintCaptureSummaries(filters(query));
      assert.equal(result.items.length, 1, `expected MORSE capture for query ${query}`);
      assert.equal(result.items[0].transcriptPreview?.text, "BLV");
      assert.equal(result.items[0].morseSummary?.expectedIdentifier, "BLV");
      assert.equal(result.items[0].analysisSummary.status, "none");
    }
    assert.equal(listSigintCaptureSummaries(filters("VFD")).items.length, 0);

    const detail = getSigintCaptureDetail("morse-capture-1");
    assert.ok(detail);
    assert.deepEqual(detail.morseSummary, {
      engine: "morse-timing@1.0.0",
      status: "completed",
      decodedText: "BLV",
      rawMorse: "-... .-.. ...-",
      confidence: 0.93,
      unresolvedCount: 0,
      frontEnd: "am_tone",
      toneHz: 1020,
      wordsPerMinute: 15,
      dotMs: 80,
      snrDb: 12.4,
      noiseFloorDb: -54.2,
      tunedFrequencyHz: 115_900_000,
      detectedFrequencyHz: 115_900_015,
      frequencyOffsetHz: 15,
      expectedIdentifier: "BLV",
      identifierMatch: true,
      catalog: { source: "ourairports", recordId: "ES-BLV", version: "2026-08-11" },
      updatedAt: new Date(Date.UTC(2026, 7, 11, 18, 0, 20)).toISOString(),
    });
    assert.equal(detail.transcripts[0].rawMorse, "-... .-.. ...-");
    assert.equal(detail.transcripts[0].confidence, 0.93);
    assert.equal(detail.audioCapture?.url, "/api/capture-files/morse-wav-1");
    assert.equal(detail.rawIqCapture?.url, "/api/capture-files/morse-iq-1");

    const reviewed = updateSigintCaptureReview("morse-capture-1", {
      status: "flagged",
      priority: "high",
      notes: "Verify identifier against the original WAV and IQ.",
    });
    assert.equal(reviewed?.reviewStatus, "flagged");
    assert.equal(reviewed?.reviewPriority, "high");
    assert.equal(reviewed?.reviewNotes, "Verify identifier against the original WAV and IQ.");
  } finally {
    if (previousDbPath === undefined) delete process.env.HACKRF_WEBUI_DB_PATH;
    else process.env.HACKRF_WEBUI_DB_PATH = previousDbPath;
    await rm(workspace, { recursive: true, force: true });
  }
});

test("MORSE capture persistence and review do not enqueue speech analysis", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "hackrf-webui-sigint-morse-ai-"));
  const dbPath = path.join(workspace, "app.sqlite");
  const previousDbPath = process.env.HACKRF_WEBUI_DB_PATH;
  process.env.HACKRF_WEBUI_DB_PATH = dbPath;

  try {
    await prepareDb(dbPath);
    seedMorseCapture(dbPath);
    const { queueCaptureAnalysisJob, ensureCaptureAnalysisUpToDate } = await import("@/server/analysis-worker");
    queueCaptureAnalysisJob("morse-capture-1");
    ensureCaptureAnalysisUpToDate("morse-capture-1");
    const sqlite = new Database(dbPath, { readonly: true });
    try {
      const count = sqlite.prepare(`
        SELECT COUNT(*) AS count FROM analysis_jobs
        WHERE capture_session_id = ? AND engine = 'sigint-audio-v2'
      `).get("morse-capture-1") as { count: number };
      assert.equal(count.count, 0);
    } finally {
      sqlite.close();
    }
  } finally {
    if (previousDbPath === undefined) delete process.env.HACKRF_WEBUI_DB_PATH;
    else process.env.HACKRF_WEBUI_DB_PATH = previousDbPath;
    await rm(workspace, { recursive: true, force: true });
  }
});
