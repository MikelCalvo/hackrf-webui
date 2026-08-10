import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worker = readFileSync(new URL("../src/server/analysis-worker.ts", import.meta.url), "utf8");

test("a successful v2 analysis removes superseded YAMNet jobs", () => {
  assert.match(worker, /inArray\(analysisJobs\.engine, \["yamnet-litert", "yamnet-vad"\]\)/);
  assert.ok(worker.includes("appDb.delete(analysisFindings).where(inArray(analysisFindings.analysisJobId, legacyJobs))"));
  assert.ok(worker.includes("appDb.delete(analysisJobs).where(inArray(analysisJobs.id, legacyJobs))"));
  assert.match(worker, /function writeSuccessfulJob/);
});
