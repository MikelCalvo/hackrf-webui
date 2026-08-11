export type MorseHoldState =
  | "SCANNING"
  | "CANDIDATE"
  | "HOLD"
  | "DECODING"
  | "POST_HOLD";

export type MorseHoldSnapshot = {
  state: MorseHoldState;
  holdOpenedAt: number | null;
  lastKeyingAt: number | null;
  postHoldStartedAt: number | null;
};

export type MorseHoldInput = {
  /** Timestamp for this deterministic progression step, in milliseconds. */
  timestamp: number;
  /** True only when pulse timing matches a plausible Morse keying pattern. */
  timingConsistentActivity: boolean;
  /** Count of timing-consistent pulses observed for the current candidate. */
  timingConsistentPulseCount: number;
  /** Timestamp of the most recent timing-consistent keying event, if any. */
  lastKeyingAt: number | null;
  /** Timing-consistent pulses required to confirm a candidate. */
  candidateConfirmationCount: number;
  /** Silence allowed before an unconfirmed candidate is discarded. */
  activityGraceMs: number;
  /** Silence that marks the end of a Morse transmission. */
  endOfTransmissionSilenceMs: number;
  /** Extra scanner hold after end-of-transmission silence. */
  postHoldMs: number;
};

export function createMorseHoldSnapshot(): MorseHoldSnapshot {
  return {
    state: "SCANNING",
    holdOpenedAt: null,
    lastKeyingAt: null,
    postHoldStartedAt: null,
  };
}

function hasTimingConsistentKeying(input: MorseHoldInput): boolean {
  return input.timingConsistentActivity
    && input.timingConsistentPulseCount > 0
    && input.lastKeyingAt !== null;
}

function hasElapsed(now: number, since: number | null, durationMs: number): boolean {
  return since !== null && now - since >= Math.max(0, durationMs);
}

function scanningSnapshot(): MorseHoldSnapshot {
  return createMorseHoldSnapshot();
}

function holdSnapshot(lastKeyingAt: number): MorseHoldSnapshot {
  return {
    state: "HOLD",
    holdOpenedAt: lastKeyingAt,
    lastKeyingAt,
    postHoldStartedAt: null,
  };
}

/**
 * Progresses scanner hold state without reading clocks, telemetry, or decoder state.
 * Raw carrier/RMS activity must be filtered into timingConsistentActivity by the caller.
 */
export function progressMorseHold(
  snapshot: MorseHoldSnapshot,
  input: MorseHoldInput,
): MorseHoldSnapshot {
  const keyed = hasTimingConsistentKeying(input);
  const lastKeyingAt = keyed ? input.lastKeyingAt : snapshot.lastKeyingAt;

  switch (snapshot.state) {
    case "SCANNING":
      if (!keyed) {
        return scanningSnapshot();
      }

      return {
        state: "CANDIDATE",
        holdOpenedAt: null,
        lastKeyingAt,
        postHoldStartedAt: null,
      };

    case "CANDIDATE":
      if (keyed && input.timingConsistentPulseCount >= Math.max(1, input.candidateConfirmationCount)) {
        return holdSnapshot(lastKeyingAt!);
      }
      if (hasElapsed(input.timestamp, snapshot.lastKeyingAt, input.activityGraceMs)) {
        return scanningSnapshot();
      }

      return { ...snapshot, lastKeyingAt };

    case "HOLD":
      if (keyed) {
        return {
          ...snapshot,
          state: "DECODING",
          lastKeyingAt,
        };
      }
      if (hasElapsed(input.timestamp, snapshot.lastKeyingAt, input.endOfTransmissionSilenceMs)) {
        return {
          ...snapshot,
          state: "POST_HOLD",
          postHoldStartedAt: input.timestamp,
        };
      }

      return snapshot;

    case "DECODING":
      if (keyed) {
        return { ...snapshot, lastKeyingAt };
      }
      if (hasElapsed(input.timestamp, snapshot.lastKeyingAt, input.endOfTransmissionSilenceMs)) {
        return {
          ...snapshot,
          state: "POST_HOLD",
          postHoldStartedAt: input.timestamp,
        };
      }

      return snapshot;

    case "POST_HOLD":
      if (keyed) {
        return {
          ...snapshot,
          state: "DECODING",
          lastKeyingAt,
          postHoldStartedAt: null,
        };
      }
      if (hasElapsed(input.timestamp, snapshot.postHoldStartedAt, input.postHoldMs)) {
        return scanningSnapshot();
      }

      return snapshot;
  }
}
