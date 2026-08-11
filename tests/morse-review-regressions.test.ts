import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decodeMorseTiming } from "@/lib/morse-decoder";
import { buildMorsePersistenceRecords } from "@/server/morse-persistence";

const hackrfSource = readFileSync(new URL("../src/server/hackrf.ts", import.meta.url), "utf8");

function assertConfidenceRange(result: ReturnType<typeof decodeMorseTiming>) {
  assert.ok(Number.isFinite(result.confidence));
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
  for (const character of result.characters) {
    assert.ok(Number.isFinite(character.confidence));
    assert.ok(character.confidence >= 0 && character.confidence <= 1);
  }
  for (const gap of result.gaps) {
    assert.ok(Number.isFinite(gap.confidence));
    assert.ok(gap.confidence >= 0 && gap.confidence <= 1);
  }
}

test("native and ffmpeg CW pipelines share the same 10 kHz PCM rate", () => {
  assert.match(hackrfSource, /"-a",\s*audioRateForMode\(mode\)/);
  assert.match(hackrfSource, /"-ar",\s*audioRateForMode\(mode\)/);
});

test("dash-heavy and mixed Morse confidence remains normalized", () => {
  const cases = [
    [{ state: "on" as const, durationMs: 180 }],
    [
      { state: "on" as const, durationMs: 180 }, { state: "off" as const, durationMs: 60 },
      { state: "on" as const, durationMs: 180 }, { state: "off" as const, durationMs: 60 },
      { state: "on" as const, durationMs: 180 },
    ],
    [
      { state: "on" as const, durationMs: 60 }, { state: "off" as const, durationMs: 60 },
      { state: "on" as const, durationMs: 180 },
    ],
    [
      { state: "on" as const, durationMs: 170 }, { state: "off" as const, durationMs: 75 },
      { state: "on" as const, durationMs: 63 },
    ],
  ];
  for (const timings of cases) assertConfidenceRange(decodeMorseTiming(timings));
});

test("persistence clamps invalid confidence defensively", () => {
  const rows = buildMorsePersistenceRecords({
    captureSessionId: "capture-review",
    analysisJobId: "job-review",
    findingId: "finding-review",
    transcriptId: "transcript-review",
    tagId: (tag) => `tag-${tag}`,
    createdAtMs: 1,
    result: {
      engine: "review",
      engineVersion: "1",
      frontEnd: "cw_carrier",
      tunedFrequencyHz: 7_030_000,
      detectedFrequencyHz: null,
      frequencyOffsetHz: null,
      toneHz: 700,
      startedAtMs: 1,
      endedAtMs: 2,
      dotMs: 60,
      wordsPerMinute: 20,
      snrDb: 12,
      noiseFloorDb: -50,
      rawMorse: "---",
      decodedText: "O",
      characters: [{ text: "O", raw: "---", confidence: 1, startMs: 0, endMs: 180 }],
      confidence: 3,
      unresolvedCount: 0,
      expectedIdentifier: null,
      identifierMatch: null,
      catalog: null,
      evidence: { wav: null, iq: null },
    },
  });
  assert.equal(rows.finding.score, 1);
  assert.ok(rows.tags.every((tag) => tag.score === 1));
});
