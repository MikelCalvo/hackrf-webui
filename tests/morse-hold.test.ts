import test from "node:test";
import assert from "node:assert/strict";

import {
  createMorseHoldSnapshot,
  progressMorseHold,
  type MorseHoldInput,
} from "@/lib/morse-hold";

const timing = (overrides: Partial<MorseHoldInput> = {}): MorseHoldInput => ({
  timestamp: 10_000,
  timingConsistentActivity: true,
  timingConsistentPulseCount: 1,
  lastKeyingAt: 10_000,
  candidateConfirmationCount: 2,
  activityGraceMs: 500,
  endOfTransmissionSilenceMs: 1_500,
  postHoldMs: 800,
  ...overrides,
});

test("progressMorseHold advances a confirmed timing-consistent signal through candidate, hold, and decoding", () => {
  const scanning = createMorseHoldSnapshot();
  const candidate = progressMorseHold(scanning, timing());
  const hold = progressMorseHold(candidate, timing({
    timestamp: 10_100,
    timingConsistentPulseCount: 2,
    lastKeyingAt: 10_100,
  }));
  const decoding = progressMorseHold(hold, timing({
    timestamp: 10_200,
    timingConsistentPulseCount: 3,
    lastKeyingAt: 10_200,
  }));

  assert.equal(candidate.state, "CANDIDATE");
  assert.equal(hold.state, "HOLD");
  assert.equal(decoding.state, "DECODING");
});

test("continuous carrier without timing-consistent keying never opens HOLD", () => {
  let snapshot = createMorseHoldSnapshot();

  for (const timestamp of [10_000, 10_100, 10_200, 10_300]) {
    snapshot = progressMorseHold(snapshot, timing({
      timestamp,
      timingConsistentActivity: false,
      timingConsistentPulseCount: 99,
      lastKeyingAt: null,
    }));
  }

  assert.equal(snapshot.state, "SCANNING");
});

test("HOLD survives a word gap shorter than end-of-transmission silence", () => {
  const hold = {
    ...createMorseHoldSnapshot(),
    state: "HOLD" as const,
    holdOpenedAt: 9_000,
    lastKeyingAt: 10_000,
  };

  const duringWordGap = progressMorseHold(hold, timing({
    timestamp: 11_499,
    timingConsistentActivity: false,
    timingConsistentPulseCount: 0,
    lastKeyingAt: 10_000,
  }));

  assert.equal(duringWordGap.state, "HOLD");
});

test("decoding enters post-hold exactly at end-of-transmission silence and returns to scanning exactly at post-hold expiry", () => {
  const decoding = {
    ...createMorseHoldSnapshot(),
    state: "DECODING" as const,
    holdOpenedAt: 9_000,
    lastKeyingAt: 10_000,
  };
  const postHold = progressMorseHold(decoding, timing({
    timestamp: 11_500,
    timingConsistentActivity: false,
    timingConsistentPulseCount: 0,
    lastKeyingAt: 10_000,
  }));
  const beforeExpiry = progressMorseHold(postHold, timing({
    timestamp: 12_299,
    timingConsistentActivity: false,
    timingConsistentPulseCount: 0,
    lastKeyingAt: 10_000,
  }));
  const scanning = progressMorseHold(postHold, timing({
    timestamp: 12_300,
    timingConsistentActivity: false,
    timingConsistentPulseCount: 0,
    lastKeyingAt: 10_000,
  }));

  assert.equal(postHold.state, "POST_HOLD");
  assert.equal(beforeExpiry.state, "POST_HOLD");
  assert.equal(scanning.state, "SCANNING");
});

test("post-hold resumes decoding when timing-consistent keying returns before expiry", () => {
  const postHold = {
    ...createMorseHoldSnapshot(),
    state: "POST_HOLD" as const,
    holdOpenedAt: 9_000,
    lastKeyingAt: 10_000,
    postHoldStartedAt: 11_500,
  };

  const resumed = progressMorseHold(postHold, timing({
    timestamp: 12_299,
    timingConsistentActivity: true,
    timingConsistentPulseCount: 4,
    lastKeyingAt: 12_299,
  }));

  assert.equal(resumed.state, "DECODING");
  assert.equal(resumed.lastKeyingAt, 12_299);
});

test("candidate returns to scanning at the activity-grace boundary when confirmation is absent", () => {
  const candidate = progressMorseHold(createMorseHoldSnapshot(), timing({
    timestamp: 10_000,
    timingConsistentPulseCount: 1,
    lastKeyingAt: 10_000,
  }));

  const stillCandidate = progressMorseHold(candidate, timing({
    timestamp: 10_499,
    timingConsistentActivity: false,
    timingConsistentPulseCount: 1,
    lastKeyingAt: 10_000,
  }));
  const scanning = progressMorseHold(candidate, timing({
    timestamp: 10_500,
    timingConsistentActivity: false,
    timingConsistentPulseCount: 1,
    lastKeyingAt: 10_000,
  }));

  assert.equal(stillCandidate.state, "CANDIDATE");
  assert.equal(scanning.state, "SCANNING");
});
