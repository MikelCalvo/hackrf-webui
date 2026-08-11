import test from "node:test";
import assert from "node:assert/strict";

import { buildMorsePersistenceRecords, type MorseAnalysisResult } from "@/server/morse-persistence";

const baseResult = (overrides: Partial<MorseAnalysisResult> = {}): MorseAnalysisResult => ({
  engine: "morse-timing",
  engineVersion: "1.0.0",
  frontEnd: "cw_carrier",
  tunedFrequencyHz: 7_040_000,
  detectedFrequencyHz: 7_040_650,
  frequencyOffsetHz: 650,
  toneHz: 650,
  startedAtMs: 1_000,
  endedAtMs: 2_200,
  dotMs: 60,
  wordsPerMinute: 20,
  snrDb: 18.4,
  noiseFloorDb: -92.1,
  rawMorse: "... --- ...",
  decodedText: "SOS",
  characters: [
    { text: "S", raw: "...", confidence: 0.99, startMs: 1_000, endMs: 1_180 },
    { text: "O", raw: "---", confidence: 0.98, startMs: 1_240, endMs: 1_600 },
    { text: "S", raw: "...", confidence: 0.99, startMs: 1_660, endMs: 1_840 },
  ],
  confidence: 0.987,
  unresolvedCount: 0,
  expectedIdentifier: "SOS",
  identifierMatch: true,
  catalog: { source: "itu-morse", recordId: "distress-sos", version: "2026-08" },
  evidence: {
    wav: { path: "captures/sos.wav", sha256: "wav-sha256", byteSize: 4096 },
    iq: { path: "captures/sos.iq", sha256: "iq-sha256", byteSize: 8192 },
  },
  ...overrides,
});

const build = (result: MorseAnalysisResult) => buildMorsePersistenceRecords({
  captureSessionId: "capture-1",
  analysisJobId: "job-1",
  findingId: "finding-1",
  transcriptId: "transcript-1",
  tagId: (tag) => `tag-${tag}`,
  createdAtMs: 3_000,
  result,
});

test("builds versioned full MORSE evidence into Drizzle-compatible job, finding, transcript, and deterministic tags", () => {
  const records = build(baseResult());

  assert.deepEqual(records.analysisJob, {
    id: "job-1",
    captureSessionId: "capture-1",
    engine: "morse-timing@1.0.0",
    status: "completed",
    paramsJson: JSON.stringify({ contractVersion: 1, frontEnd: "cw_carrier", toneHz: 650 }),
    startedAtMs: 1_000,
    endedAtMs: 2_200,
    createdAtMs: 3_000,
  });
  assert.equal(records.finding.kind, "morse_decode");
  assert.equal(records.finding.score, 0.987);
  assert.equal(records.finding.startMs, 1_000);
  assert.equal(records.finding.endMs, 2_200);
  assert.deepEqual(JSON.parse(records.finding.dataJson!), {
    contractVersion: 1,
    engine: { name: "morse-timing", version: "1.0.0" },
    frontEnd: "cw_carrier",
    frequency: { tunedHz: 7_040_000, detectedHz: 7_040_650, offsetHz: 650 },
    toneHz: 650,
    timing: { startMs: 1_000, endMs: 2_200, dotMs: 60, wordsPerMinute: 20, elements: baseResult().characters },
    signal: { snrDb: 18.4, noiseFloorDb: -92.1 },
    rawMorse: "... --- ...",
    decodedText: "SOS",
    confidence: { overall: 0.987, characters: baseResult().characters, unresolvedCount: 0 },
    identifier: { expected: "SOS", match: true },
    catalog: { source: "itu-morse", recordId: "distress-sos", version: "2026-08" },
    evidence: baseResult().evidence,
  });
  assert.equal(records.transcript.engine, "morse-timing@1.0.0");
  assert.equal(records.transcript.language, "morse");
  assert.equal(records.transcript.text, "SOS");
  assert.deepEqual(JSON.parse(records.transcript.segmentsJson!), {
    contractVersion: 1,
    rawMorse: "... --- ...",
    confidence: 0.987,
    unresolvedCount: 0,
    characters: baseResult().characters,
  });
  assert.deepEqual(records.tags.map(({ id, tag, source, score }) => ({ id, tag, source, score })), [
    { id: "tag-morse", tag: "morse", source: "morse-timing@1.0.0", score: 0.987 },
    { id: "tag-morse:front-end:cw_carrier", tag: "morse:front-end:cw_carrier", source: "morse-timing@1.0.0", score: 0.987 },
    { id: "tag-morse:identifier-match", tag: "morse:identifier-match", source: "morse-timing@1.0.0", score: 0.987 },
    { id: "tag-morse:catalog:itu-morse", tag: "morse:catalog:itu-morse", source: "morse-timing@1.0.0", score: 0.987 },
  ]);
});

test("preserves partial raw evidence and unknown characters rather than guessing", () => {
  const result = baseResult({
    frontEnd: "am_tone",
    rawMorse: ".- ..--..",
    decodedText: "A?",
    characters: [
      { text: "A", raw: ".-", confidence: 0.92, startMs: 1_000, endMs: 1_120 },
      { text: "?", raw: "..--..", confidence: 0.31, startMs: 1_180, endMs: 1_540 },
    ],
    confidence: 0.615,
    unresolvedCount: 1,
    expectedIdentifier: "AB",
    identifierMatch: false,
    catalog: null,
  });
  const records = build(result);

  assert.equal(records.analysisJob.status, "completed_partial");
  assert.equal(records.transcript.text, "A?");
  const evidence = JSON.parse(records.finding.dataJson!);
  assert.equal(evidence.rawMorse, ".- ..--..");
  assert.equal(evidence.decodedText, "A?");
  assert.deepEqual(evidence.confidence.characters[1], result.characters[1]);
  assert.equal(evidence.confidence.unresolvedCount, 1);
  assert.deepEqual(records.tags.map((tag) => tag.tag), ["morse", "morse:front-end:am_tone", "morse:partial", "morse:identifier-mismatch"]);
});

test("persists a no-text analysis with an explicit unknown transcript and original empty raw evidence", () => {
  const records = build(baseResult({
    frontEnd: "audio_tone",
    rawMorse: "",
    decodedText: "",
    characters: [],
    confidence: 0,
    unresolvedCount: 0,
    expectedIdentifier: null,
    identifierMatch: null,
    catalog: null,
  }));

  assert.equal(records.analysisJob.status, "completed_no_text");
  assert.equal(records.transcript.text, "?");
  assert.deepEqual(JSON.parse(records.transcript.segmentsJson!), {
    contractVersion: 1,
    rawMorse: "",
    confidence: 0,
    unresolvedCount: 0,
    characters: [],
  });
  assert.deepEqual(records.tags.map((tag) => tag.tag), ["morse", "morse:front-end:audio_tone", "morse:no-text"]);
});
