import test from "node:test";
import assert from "node:assert/strict";

import { decodeMorseTiming, type MorseTimingSample } from "@/lib/morse-decoder";

const encode = (characters: string[], dotMs = 60): MorseTimingSample[] => {
  const code: Record<string, string> = {
    A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---",
    K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
    0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----.",
    ".": ".-.-.-", ",": "--..--", "?": "..--..", "/": "-..-.", "@": ".--.-.",
  };
  const samples: MorseTimingSample[] = [];
  for (const character of characters) {
    if (character === " ") {
      if (samples.at(-1)?.state === "off") samples.at(-1)!.durationMs = dotMs * 7;
      continue;
    }
    for (const [index, mark] of [...code[character]].entries()) {
      samples.push({ state: "on", durationMs: dotMs * (mark === "." ? 1 : 3) });
      if (index < code[character].length - 1) samples.push({ state: "off", durationMs: dotMs });
    }
    samples.push({ state: "off", durationMs: dotMs * 3 });
  }
  return samples;
};

test("decodes SOS and exposes raw Morse groups with high confidence", () => {
  const result = decodeMorseTiming(encode(["S", "O", "S"]));

  assert.equal(result.text, "SOS");
  assert.equal(result.dotDurationMs, 60);
  assert.equal(result.wordsPerMinute, 20);
  assert.deepEqual(result.rawGroups, ["...", "---", "..."]);
  assert.ok(result.confidence > 0.99);
  assert.deepEqual(result.characters.map(({ text, raw, confidence }) => ({ text, raw, confidence: confidence > 0.99 })), [
    { text: "S", raw: "...", confidence: true },
    { text: "O", raw: "---", confidence: true },
    { text: "S", raw: "...", confidence: true },
  ]);
});

test("decodes PARIS and common ITU punctuation and digits", () => {
  const result = decodeMorseTiming(encode(["P", "A", "R", "I", "S", " ", "?", "2"]));

  assert.equal(result.text, "PARIS ?2");
  assert.deepEqual(result.rawGroups, [".--.", ".-", ".-.", "..", "...", "/", "..--..", "..---"]);
});

test("classifies standard intra-character, character, and word gaps", () => {
  const result = decodeMorseTiming([
    { state: "on", durationMs: 60 }, { state: "off", durationMs: 60 },
    { state: "on", durationMs: 60 }, { state: "off", durationMs: 180 },
    { state: "on", durationMs: 60 }, { state: "off", durationMs: 420 },
  ]);

  assert.deepEqual(result.gaps.map(({ kind, units }) => ({ kind, units })), [
    { kind: "intra-character", units: 1 },
    { kind: "inter-character", units: 3 },
    { kind: "inter-word", units: 7 },
  ]);
});

test("tolerates bounded hand-timed variation while estimating timing", () => {
  const samples: MorseTimingSample[] = [
    { state: "on", durationMs: 63 }, { state: "off", durationMs: 55 }, { state: "on", durationMs: 171 },
    { state: "off", durationMs: 184 }, { state: "on", durationMs: 58 }, { state: "off", durationMs: 62 },
    { state: "on", durationMs: 64 }, { state: "off", durationMs: 59 }, { state: "on", durationMs: 57 },
  ];
  const result = decodeMorseTiming(samples);

  assert.equal(result.text, "AS");
  const dotDurationMs = result.dotDurationMs;
  const wordsPerMinute = result.wordsPerMinute;
  assert.notEqual(dotDurationMs, null);
  assert.notEqual(wordsPerMinute, null);
  assert.ok(dotDurationMs !== null && dotDurationMs >= 57 && dotDurationMs <= 63);
  assert.ok(wordsPerMinute !== null && wordsPerMinute >= 19 && wordsPerMinute <= 21);
  assert.ok(result.confidence > 0.8);
});

test("marks unknown and truncated groups without guessing words", () => {
  const unknown = decodeMorseTiming(encode(["A"]).concat([
    { state: "off", durationMs: 180 },
    ...Array.from({ length: 12 }, (_, index): MorseTimingSample => ({ state: index % 2 === 0 ? "on" : "off", durationMs: 60 })),
  ]));
  const truncated = decodeMorseTiming([{ state: "off", durationMs: 60 }, { state: "on", durationMs: 60 }, { state: "off", durationMs: 60 }]);

  assert.equal(unknown.text, "A?");
  assert.equal(unknown.characters.at(-1)?.text, "?");
  assert.ok(unknown.characters.at(-1)!.confidence < 1);
  assert.equal(truncated.text, "E");
  assert.equal(truncated.truncated, true);
});

test("returns an empty, zero-confidence result for no timing samples", () => {
  const result = decodeMorseTiming([]);

  assert.deepEqual(result, {
    text: "",
    dotDurationMs: null,
    wordsPerMinute: null,
    rawGroups: [],
    gaps: [],
    characters: [],
    confidence: 0,
    truncated: false,
  });
});
