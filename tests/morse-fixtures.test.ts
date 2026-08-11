import assert from "node:assert/strict";
import test from "node:test";

import {
  createContinuousTonePcm,
  createNoisePcm,
  createMorsePcm,
  encodeMorseTiming,
} from "@/lib/morse-fixtures";

test("encodeMorseTiming produces exact standard PARIS and SOS timing", () => {
  const paris = encodeMorseTiming("PARIS", { dotMs: 60 });
  const sos = encodeMorseTiming("SOS", { dotMs: 60 });

  assert.equal(paris.dotMs, 60);
  assert.equal(paris.wordsPerMinute, 20);
  assert.deepEqual(paris.samples.slice(0, 8), [
    { state: "on", durationMs: 60 }, { state: "off", durationMs: 60 },
    { state: "on", durationMs: 180 }, { state: "off", durationMs: 60 },
    { state: "on", durationMs: 180 }, { state: "off", durationMs: 60 },
    { state: "on", durationMs: 60 }, { state: "off", durationMs: 180 },
  ]);
  assert.deepEqual(sos.samples, [
    { state: "on", durationMs: 60 }, { state: "off", durationMs: 60 }, { state: "on", durationMs: 60 }, { state: "off", durationMs: 60 }, { state: "on", durationMs: 60 }, { state: "off", durationMs: 180 },
    { state: "on", durationMs: 180 }, { state: "off", durationMs: 60 }, { state: "on", durationMs: 180 }, { state: "off", durationMs: 60 }, { state: "on", durationMs: 180 }, { state: "off", durationMs: 180 },
    { state: "on", durationMs: 60 }, { state: "off", durationMs: 60 }, { state: "on", durationMs: 60 }, { state: "off", durationMs: 60 }, { state: "on", durationMs: 60 },
  ]);
});

test("encodeMorseTiming supports WPM and Farnsworth spacing without changing marks", () => {
  const timing = encodeMorseTiming("E E", { wpm: 20, farnsworthWpm: 10 });

  assert.equal(timing.dotMs, 60);
  assert.equal(timing.characterGapMs, 360);
  assert.equal(timing.wordGapMs, 840);
  assert.deepEqual(timing.samples, [
    { state: "on", durationMs: 60 }, { state: "off", durationMs: 840 }, { state: "on", durationMs: 60 },
  ]);
});

test("encodeMorseTiming encodes unsupported input as an explicit question mark", () => {
  const timing = encodeMorseTiming("A♥?", { dotMs: 50 });

  assert.equal(timing.text, "A??");
  assert.equal(timing.unsupported, 1);
  assert.deepEqual(timing.samples.slice(-11), [
    { state: "on", durationMs: 50 }, { state: "off", durationMs: 50 }, { state: "on", durationMs: 50 }, { state: "off", durationMs: 50 },
    { state: "on", durationMs: 150 }, { state: "off", durationMs: 50 }, { state: "on", durationMs: 150 }, { state: "off", durationMs: 50 },
    { state: "on", durationMs: 50 }, { state: "off", durationMs: 50 }, { state: "on", durationMs: 50 },
  ]);
});

test("createMorsePcm is deterministic, honors sample count, and reconstructs chunks", () => {
  const options = {
    sampleRate: 8_000, toneHz: 700, amplitude: 0.5, dotMs: 10,
    leadingSilenceMs: 5, trailingSilenceMs: 7, noiseSeed: 42, snrDb: 20, chunkSamples: 37,
  };
  const first = createMorsePcm("E", options);
  const second = createMorsePcm("E", options);

  assert.deepEqual([...first.pcm], [...second.pcm]);
  assert.equal(first.pcm.length, 176);
  assert.equal(first.chunks.reduce((total, chunk) => total + chunk.length, 0), first.pcm.length);
  assert.deepEqual([...first.chunks.flatMap((chunk) => [...chunk])], [...first.pcm]);
  assert.deepEqual([...first.pcm.slice(0, 40)], Array(40).fill(0));
  assert.deepEqual([...first.pcm.slice(-56)], Array(56).fill(0));
});

test("createMorsePcm constrains drift and fading envelope", () => {
  const result = createMorsePcm("E", {
    sampleRate: 1_000, toneHz: 100, amplitude: 0.8, dotMs: 100,
    frequencyOffsetHz: 10, frequencyDriftHz: 20, fadeMs: 20,
  });

  assert.equal(result.toneHz.start, 110);
  assert.equal(result.toneHz.end, 130);
  assert.ok(Math.abs(result.pcm[0]) < 0.001);
  assert.ok(Math.abs(result.pcm[99]) < 0.001);
  assert.ok(Math.max(...result.pcm.map(Math.abs)) <= 0.8);
});

test("non-Morse controls create deterministic bounded tone and seeded noise", () => {
  const tone = createContinuousTonePcm({ sampleRate: 1_000, durationMs: 10, toneHz: 100, amplitude: 0.25 });
  const firstNoise = createNoisePcm({ sampleRate: 1_000, durationMs: 10, amplitude: 0.25, seed: 7, chunkSamples: 3 });
  const secondNoise = createNoisePcm({ sampleRate: 1_000, durationMs: 10, amplitude: 0.25, seed: 7, chunkSamples: 3 });

  assert.equal(tone.pcm.length, 10);
  assert.ok(Math.max(...tone.pcm.map(Math.abs)) <= 0.25);
  assert.deepEqual([...firstNoise.pcm], [...secondNoise.pcm]);
  assert.ok(firstNoise.pcm.some((sample) => sample !== 0));
  assert.ok(Math.max(...firstNoise.pcm.map(Math.abs)) <= 0.25);
  assert.deepEqual([...firstNoise.chunks.flatMap((chunk) => [...chunk])], [...firstNoise.pcm]);
});
