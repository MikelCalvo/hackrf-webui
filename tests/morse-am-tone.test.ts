import assert from "node:assert/strict";
import test from "node:test";

import { createMorseRuntime } from "@/lib/morse-runtime";
import { encodeMorseTiming } from "@/lib/morse-fixtures";

function keyedAmIdent(text: string, sampleRate = 10_000, toneHz = 1_020, wpm = 15): Float32Array {
  const timing = encodeMorseTiming(text, { wpm });
  const totalMs = 1_000 + timing.samples.reduce((sum, sample) => sum + sample.durationMs, 0) + 2_000;
  const output = new Float32Array(Math.ceil(totalMs * sampleRate / 1_000));
  let sample = sampleRate;
  for (const timingSample of timing.samples) {
    const count = Math.round(timingSample.durationMs * sampleRate / 1_000);
    if (timingSample.state === "on") {
      for (let offset = 0; offset < count; offset += 1) {
        output[sample + offset] = 0.7 * Math.sin(2 * Math.PI * toneHz * (sample + offset) / sampleRate);
      }
    }
    sample += count;
  }
  return output;
}

test("AM-tone runtime decodes a standard 1020 Hz VOR identifier", () => {
  const runtime = createMorseRuntime({
    sampleRate: 10_000,
    toneHz: 1_020,
    toneSearchHz: 100,
    minSnrDb: 7,
    candidateConfirmationCount: 2,
    activityGraceMs: 500,
    endOfTransmissionSilenceMs: 1_000,
    postHoldMs: 500,
  });
  const samples = keyedAmIdent("BCN");
  let completed = null;
  let latestText = "";
  for (let offset = 0; offset < samples.length; offset += 337) {
    const result = runtime.process(samples.subarray(offset, offset + 337), offset / 10);
    latestText = result.partialDecode.text;
    if (result.completedDecode) completed = result.completedDecode;
  }
  assert.equal(completed?.text ?? latestText, "BCN");
});
