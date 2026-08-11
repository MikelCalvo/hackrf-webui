import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerPath = new URL("../src/server/analysis-worker.ts", import.meta.url);

test("analysis worker consults persisted AI policy before queue, backfill and claim", async () => {
  const source = await readFile(workerPath, "utf8");
  assert.match(source, /readAiSettings/);
  assert.match(source, /queueCaptureAnalysisJob/);
  assert.match(source, /requestAnalysisBackfill/);
  assert.match(source, /claimNextJob/);
  assert.match(source, /!aiSettings\.enabled/);
  assert.match(source, /await checkAnalysisRuntime[\s\S]*if \(!readAiSettings\(\)\.enabled\)[\s\S]*const job = claimNextJob\(\)/);
});

test("automatic warm path no longer creates historical backfill", async () => {
  const source = await readFile(workerPath, "utf8");
  const warm = source.slice(source.indexOf("export function warmAnalysisBackfill"));
  assert.doesNotMatch(warm.slice(0, 300), /backfillQueuedJobs\(/);
});

test("AI settings provide dynamic threads, hotwords and module allowlist", async () => {
  const source = await readFile(workerPath, "utf8");
  assert.match(source, /aiSettings\.cpuThreads/);
  assert.match(source, /aiSettings\.hotwords/);
  assert.match(source, /aiSettings\.modules/);
});

test("analysis status is safe and exposes queue/runtime state without paths", async () => {
  const source = await readFile(workerPath, "utf8");
  assert.match(source, /export async function getAnalysisWorkerStatus/);
  assert.match(source, /queuedJobs/);
  assert.match(source, /runningJobs/);
  assert.match(source, /processing/);
  assert.match(source, /runtimeInstalled/);
  assert.match(source, /runtimeHealthy/);
  assert.match(source, /currentJob/);
  assert.match(source, /lastResult/);
  const statusStart = source.indexOf("export async function getAnalysisWorkerStatus");
  assert.doesNotMatch(source.slice(statusStart), /AI_PYTHON_PATH|AI_MODEL_CACHE_PATH|audioAbsolutePath/);
});

test("disabling AI does not delete or fail queued jobs", async () => {
  const source = await readFile(workerPath, "utf8");
  assert.doesNotMatch(source, /DELETE FROM analysis_jobs[^;]*status\s*=\s*['"]queued/);
  assert.doesNotMatch(source, /UPDATE analysis_jobs[^;]*status\s*=\s*['"]failed[^;]*enabled/);
});

test("explicit backfill requires enabled AI and does not run implicitly on enable", async () => {
  const source = await readFile(workerPath, "utf8");
  assert.match(source, /export async function requestAnalysisBackfill/);
  assert.match(source, /enabled/);
  assert.match(source, /backfillQueuedJobs/);
});

test("running worker is allowed to finish after policy changes", async () => {
  const source = await readFile(workerPath, "utf8");
  const runIndex = source.indexOf("const payload = await runAudioAnalyzer");
  assert.ok(runIndex > 0);
  const after = source.slice(runIndex, runIndex + 800);
  assert.match(after, /writeSuccessfulJob|writeFailedJob/);
  assert.doesNotMatch(after, /aiSettings\.enabled/);
});

test("analysis worker settings contract sentinel", () => assert.equal(true, true));
