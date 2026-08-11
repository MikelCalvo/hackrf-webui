import test from "node:test";
import assert from "node:assert/strict";

import { MorseToneDetector } from "@/lib/morse-tone-detector";

const sampleRate = 8_000;
const windowSamples = 80; // 10 ms

function tone(
  frequency: number,
  samples: number,
  amplitude = 0.7,
  phase = 0,
): Float32Array {
  return Float32Array.from(
    { length: samples },
    (_, index) => amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate + phase),
  );
}

function concat(...frames: Float32Array[]): Float32Array {
  const output = new Float32Array(frames.reduce((total, frame) => total + frame.length, 0));
  let offset = 0;
  for (const frame of frames) {
    output.set(frame, offset);
    offset += frame.length;
  }
  return output;
}

function deterministicNoise(samples: number, amplitude = 0.12): Float32Array {
  let state = 0x12345678;
  return Float32Array.from({ length: samples }, () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return amplitude * ((state / 0xffffffff) * 2 - 1);
  });
}

function detector() {
  return new MorseToneDetector({
    sampleRate,
    toneHz: 700,
    toneSearchHz: 80,
    windowSamples,
    minSnrDb: 9,
    hysteresisDb: 3,
    attackWindows: 2,
    releaseWindows: 2,
  });
}

test("detects the keyed ON/OFF envelope of a synthetic 700 Hz SOS stream", () => {
  const unit = 8 * windowSamples;
  const envelope = [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const input = concat(...envelope.map((keyed) => (keyed ? tone(700, unit) : new Float32Array(unit))));
  const result = detector().process(input, 1_000);

  assert.deepEqual(result.transitions.map(({ state }) => state), ["ON", "OFF", "ON", "OFF", "ON", "OFF", "ON", "OFF", "ON", "OFF", "ON"]);
  assert.equal(result.isMorseCandidate, true);
  assert.ok(result.transitions.every((transition) => transition.sample >= 0 && transition.timestampMs >= 1_000));
  assert.ok(result.transitions.filter((transition) => transition.state === "OFF").every((transition) => transition.durationSamples > 0));
});

test("tolerates ±60 Hz tone drift while rejecting silence and broadband noise", () => {
  for (const frequency of [640, 760]) {
    const result = detector().process(concat(new Float32Array(4 * windowSamples), tone(frequency, 8 * windowSamples), new Float32Array(4 * windowSamples)));
    assert.deepEqual(result.transitions.map(({ state }) => state), ["ON", "OFF"], `${frequency} Hz`);
    assert.ok(result.metrics.toneHz >= 620 && result.metrics.toneHz <= 780);
  }

  const silence = detector().process(new Float32Array(20 * windowSamples));
  const noise = detector().process(deterministicNoise(20 * windowSamples));
  assert.deepEqual(silence.transitions, []);
  assert.deepEqual(noise.transitions, []);
  assert.equal(noise.isMorseCandidate, false);
  assert.ok(noise.metrics.snrDb < 9);
});

test("produces identical transitions when PCM arrives at arbitrary chunk boundaries", () => {
  const input = concat(
    new Float32Array(3 * windowSamples),
    tone(700, 7 * windowSamples),
    new Float32Array(5 * windowSamples),
    tone(700, 6 * windowSamples),
    new Float32Array(4 * windowSamples),
  );
  const oneChunk = detector().process(input).transitions;
  const streaming = detector();
  const chunks = [137, 211, 58, 677, input.length];
  let offset = 0;
  const transitions = [];
  for (const length of chunks) {
    if (offset >= input.length) break;
    transitions.push(...streaming.process(input.slice(offset, Math.min(input.length, offset + length))).transitions);
    offset += length;
  }
  assert.deepEqual(transitions, oneChunk);
});

test("does not classify an unkeyed continuous carrier as Morse until it is keyed off", () => {
  const active = detector().process(tone(700, 40 * windowSamples));
  assert.deepEqual(active.transitions.map(({ state }) => state), ["ON"]);
  assert.equal(active.isMorseCandidate, false);

  const released = active.detector.process(new Float32Array(4 * windowSamples));
  assert.deepEqual(released.transitions.map(({ state }) => state), ["OFF"]);
  assert.equal(released.isMorseCandidate, true);
});

test("uses hysteresis to prevent threshold-adjacent chatter and reset clears stream state", () => {
  const keyed = detector();
  keyed.process(tone(700, 6 * windowSamples));
  const nearThreshold = concat(
    ...Array.from({ length: 12 }, (_, index) => tone(700, windowSamples, index % 2 ? 0.16 : 0.18)),
  );
  const result = keyed.process(nearThreshold);
  assert.deepEqual(result.transitions, [], "small level variation must not chatter OFF/ON");

  const beforeReset = keyed.process(new Float32Array(4 * windowSamples));
  assert.deepEqual(beforeReset.transitions.map(({ state }) => state), ["OFF"]);
  keyed.reset();
  const afterReset = keyed.process(new Float32Array(4 * windowSamples));
  assert.deepEqual(afterReset.transitions, []);
  assert.equal(afterReset.metrics.sample, 4 * windowSamples);
});
