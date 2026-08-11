import {
  MorseToneDetector,
  type MorseKeyState,
  type MorseToneDetectorOptions,
  type MorseToneMetrics,
  type MorseToneTransition,
} from "@/lib/morse-tone-detector";
import {
  decodeMorseTiming,
  type MorseDecodeResult,
  type MorseTimingSample,
} from "@/lib/morse-decoder";
import {
  createMorseHoldSnapshot,
  progressMorseHold,
  type MorseHoldSnapshot,
} from "@/lib/morse-hold";

export interface MorseRuntimeOptions extends MorseToneDetectorOptions {
  candidateConfirmationCount?: number;
  activityGraceMs?: number;
  endOfTransmissionSilenceMs?: number;
  postHoldMs?: number;
}

export interface MorseRuntimeResult {
  hold: MorseHoldSnapshot;
  timingSamples: readonly MorseTimingSample[];
  partialDecode: MorseDecodeResult;
  completedDecode?: MorseDecodeResult;
  pulseCount: number;
  metrics: MorseToneMetrics;
}

/**
 * Pure, deterministic streaming bridge from demodulated PCM to Morse timing evidence.
 * It deliberately treats a carrier as one unfinished mark, not as Morse keying.
 */
export class MorseRuntime {
  private readonly detector: MorseToneDetector;
  private readonly options: Required<Pick<MorseRuntimeOptions,
    "candidateConfirmationCount" | "activityGraceMs" | "endOfTransmissionSilenceMs" | "postHoldMs"
  >>;
  private readonly sampleRate: number;
  private hold = createMorseHoldSnapshot();
  private timings: MorseTimingSample[] = [];
  private pulseCount = 0;
  private lastOn: MorseToneTransition | null = null;
  private lastOff: MorseToneTransition | null = null;
  private completed = false;

  constructor(options: MorseRuntimeOptions) {
    this.sampleRate = options.sampleRate;
    this.detector = new MorseToneDetector(options);
    this.options = {
      candidateConfirmationCount: Math.max(2, Math.round(options.candidateConfirmationCount ?? 2)),
      activityGraceMs: Math.max(0, options.activityGraceMs ?? 500),
      endOfTransmissionSilenceMs: Math.max(0, options.endOfTransmissionSilenceMs ?? 1_500),
      postHoldMs: Math.max(0, options.postHoldMs ?? 800),
    };
  }

  reset(): void {
    this.detector.reset();
    this.hold = createMorseHoldSnapshot();
    this.timings = [];
    this.pulseCount = 0;
    this.lastOn = null;
    this.lastOff = null;
    this.completed = false;
  }

  process(frame: Float32Array, timestampMs?: number): MorseRuntimeResult {
    const tone = this.detector.process(frame, timestampMs);
    let completedDecode: MorseDecodeResult | undefined;

    for (const transition of tone.transitions) {
      const pulse = this.consumeTransition(transition);
      const timestamp = transition.timestampMs;
      this.hold = progressMorseHold(this.hold, this.holdInput(timestamp, pulse, timestamp));
    }

    const now = (Number.isFinite(timestampMs) ? timestampMs as number : 0)
      + (tone.metrics.sample * 1000) / this.sampleRate;
    const eotAt = this.hold.lastKeyingAt === null
      ? now
      : this.hold.lastKeyingAt + this.options.endOfTransmissionSilenceMs;
    if ((this.hold.state === "HOLD" || this.hold.state === "DECODING") && now >= eotAt) {
      // Use the actual EOT boundary so large and small PCM chunks progress identically.
      this.hold = progressMorseHold(this.hold, this.holdInput(eotAt, false, null));
    }
    const beforeCompletion = this.hold.state;
    this.hold = progressMorseHold(this.hold, this.holdInput(now, false, null));
    const evidence = this.evidenceAt(now);
    if (!this.completed && beforeCompletion === "POST_HOLD" && this.hold.state === "SCANNING" && evidence.length > 0) {
      completedDecode = decodeMorseTiming(evidence);
      this.completed = true;
    }

    return {
      hold: { ...this.hold },
      timingSamples: this.timings.map((sample) => ({ ...sample })),
      partialDecode: decodeMorseTiming(evidence),
      completedDecode,
      pulseCount: this.pulseCount,
      metrics: { ...tone.metrics },
    };
  }

  private consumeTransition(transition: MorseToneTransition): boolean {
    if (transition.state === "ON") {
      if (this.lastOff) this.pushTiming("off", transition.sample - this.lastOff.sample);
      this.lastOn = transition;
      return false;
    }

    if (!this.lastOn) return false;
    this.pushTiming("on", transition.sample - this.lastOn.sample);
    this.lastOff = transition;
    this.lastOn = null;
    this.pulseCount += 1;
    return this.isTimingConsistent();
  }

  private pushTiming(state: Lowercase<MorseKeyState>, durationSamples: number): void {
    if (durationSamples <= 0) return;
    this.timings.push({ state, durationMs: (durationSamples * 1000) / this.sampleRate });
  }

  private evidenceAt(now: number): MorseTimingSample[] {
    if (!this.lastOff) return this.timings;
    const openGapMs = Math.max(0, now - this.lastOff.timestampMs);
    return openGapMs > 0 ? [...this.timings, { state: "off", durationMs: openGapMs }] : this.timings;
  }

  private isTimingConsistent(): boolean {
    const marks = this.timings.filter((sample) => sample.state === "on").map((sample) => sample.durationMs);
    if (marks.length === 0) return false;
    const shortest = Math.min(...marks);
    const longest = Math.max(...marks);
    // Standard marks are one or three units; a little tolerance retains hand-sent evidence.
    return shortest > 0 && longest / shortest <= 4.5;
  }

  private holdInput(timestamp: number, timingConsistentActivity: boolean, lastKeyingAt: number | null) {
    return {
      timestamp,
      timingConsistentActivity,
      timingConsistentPulseCount: this.pulseCount,
      lastKeyingAt,
      ...this.options,
    };
  }
}

export function createMorseRuntime(options: MorseRuntimeOptions): MorseRuntime {
  return new MorseRuntime(options);
}
