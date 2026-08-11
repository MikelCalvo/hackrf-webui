import test from "node:test";
import assert from "node:assert/strict";

import { MorseRuntime } from "@/lib/morse-runtime";

const sampleRate = 8_000;
const windowSamples = 80;
const unitSamples = 8 * windowSamples;

function tone(samples: number, phase = 0): Float32Array {
  return Float32Array.from(
    { length: samples },
    (_, index) => 0.7 * Math.sin((2 * Math.PI * 700 * index) / sampleRate + phase),
  );
}

function silence(samples: number): Float32Array {
  return new Float32Array(samples);
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

function runtime(): MorseRuntime {
  return new MorseRuntime({
    sampleRate,
    toneHz: 700,
    toneSearchHz: 80,
    windowSamples,
    attackWindows: 2,
    releaseWindows: 2,
    candidateConfirmationCount: 2,
    activityGraceMs: 160,
    endOfTransmissionSilenceMs: 300,
    postHoldMs: 100,
  });
}

function sosPcm(trailingSilenceUnits = 0): Float32Array {
  const dot = () => tone(unitSamples);
  const dash = () => tone(3 * unitSamples);
  const intra = () => silence(unitSamples);
  const character = () => silence(3 * unitSamples);
  return concat(
    dot(), intra(), dot(), intra(), dot(), character(),
    dash(), intra(), dash(), intra(), dash(), character(),
    dot(), intra(), dot(), intra(), dot(),
    silence(trailingSilenceUnits * unitSamples),
  );
}

test("streams keyed PCM into timing evidence, a live HOLD snapshot, and one completed SOS decode", () => {
  const decoder = runtime();
  const result = decoder.process(sosPcm(8));

  assert.equal(result.pulseCount, 9);
  assert.equal(result.hold.state, "SCANNING");
  assert.equal(result.partialDecode.text, "SOS");
  assert.equal(result.completedDecode?.text, "SOS");
  assert.equal(result.completedDecode?.truncated, false);
  assert.ok(result.timingSamples.length >= 17);
  assert.ok(Number.isFinite(result.metrics.snrDb), "exposes latest tone/SNR metrics even after silence");
  assert.equal(decoder.process(silence(windowSamples)).completedDecode, undefined, "completion is emitted once");
});

test("is invariant to arbitrary PCM chunk boundaries", () => {
  const input = sosPcm(8);
  const whole = runtime().process(input);
  const streaming = runtime();
  let last = streaming.process(new Float32Array());
  let offset = 0;
  for (const length of [137, 211, 58, 677, 41, 997, input.length]) {
    if (offset >= input.length) break;
    last = streaming.process(input.slice(offset, Math.min(offset + length, input.length)));
    offset += length;
  }

  assert.deepEqual(last.timingSamples, whole.timingSamples);
  assert.deepEqual(last.partialDecode, whole.partialDecode);
  assert.deepEqual(last.completedDecode, whole.completedDecode);
  assert.deepEqual(last.hold, whole.hold);
});

test("rejects a continuous carrier as a confirmed Morse HOLD", () => {
  const decoder = runtime();
  const active = decoder.process(tone(40 * windowSamples));
  const released = decoder.process(silence(40 * windowSamples));

  assert.equal(active.pulseCount, 0);
  assert.equal(active.hold.state, "SCANNING");
  assert.equal(released.pulseCount, 1);
  assert.equal(released.hold.state, "SCANNING");
  assert.equal(released.completedDecode, undefined);
});

test("keeps unknown and truncated raw timing evidence in the final decode", () => {
  const decoder = runtime();
  const unknown = concat(
    ...Array.from({ length: 12 }, (_, index) => index % 2 === 0 ? tone(unitSamples) : silence(unitSamples)),
    silence(8 * unitSamples),
  );
  const result = decoder.process(unknown);

  assert.ok(result.completedDecode);
  assert.equal(result.completedDecode?.characters.at(-1)?.text, "?");
  assert.ok(result.completedDecode!.rawGroups.some((group: string) => group.length >= 6));
  assert.ok(result.timingSamples.some((sample) => sample.state === "on"));
});

// A stream which has not supplied end-of-transmission silence is preserved as partial evidence.
test("reports an incomplete final mark as a truncated partial decode before completion", () => {
  const result = runtime().process(concat(tone(unitSamples), silence(10 * windowSamples)));

  assert.equal(result.partialDecode.text, "E");
  assert.equal(result.partialDecode.truncated, true);
  assert.equal(result.completedDecode, undefined);
});
