export type MorseKeyState = "ON" | "OFF";

export interface MorseToneDetectorOptions {
  sampleRate: number;
  toneHz?: number;
  toneSearchHz?: number;
  windowSamples?: number;
  minSnrDb?: number;
  hysteresisDb?: number;
  attackWindows?: number;
  releaseWindows?: number;
}

export interface MorseToneMetrics {
  sample: number;
  toneHz: number;
  tonePower: number;
  noisePower: number;
  snrDb: number;
  threshold: number;
  transitionConfidence: number;
}

export interface MorseToneTransition {
  state: MorseKeyState;
  sample: number;
  timestampMs: number;
  durationSamples: number;
  confidence: number;
}

export interface MorseToneResult {
  detector: MorseToneDetector;
  transitions: MorseToneTransition[];
  metrics: MorseToneMetrics;
  isKeyed: boolean;
  isMorseCandidate: boolean;
}

const EPSILON = 1e-12;

/** A deterministic narrowband tone/keying detector for already-demodulated mono PCM. */
export class MorseToneDetector {
  private readonly options: Required<MorseToneDetectorOptions>;
  private readonly frequencies: number[];
  private remainder = new Float32Array(0);
  private totalSamples = 0;
  private baseTimestampMs: number | null = null;
  private keyed = false;
  private onWindows = 0;
  private offWindows = 0;
  private noiseFloor = EPSILON;
  private transitionsSeen = 0;
  private lastTransitionSample = 0;
  private metrics: MorseToneMetrics;

  constructor(options: MorseToneDetectorOptions) {
    if (!Number.isFinite(options.sampleRate) || options.sampleRate <= 0) throw new Error("sampleRate must be positive");
    const windowSamples = Math.max(16, Math.round(options.windowSamples ?? Math.max(64, options.sampleRate / 100)));
    this.options = {
      sampleRate: options.sampleRate,
      toneHz: options.toneHz ?? 700,
      toneSearchHz: Math.max(0, options.toneSearchHz ?? 60),
      windowSamples,
      minSnrDb: options.minSnrDb ?? 9,
      hysteresisDb: Math.max(0, options.hysteresisDb ?? 3),
      attackWindows: Math.max(1, Math.round(options.attackWindows ?? 2)),
      releaseWindows: Math.max(1, Math.round(options.releaseWindows ?? 2)),
    };
    const step = Math.max(5, this.options.sampleRate / windowSamples / 8);
    this.frequencies = [];
    for (let hz = this.options.toneHz - this.options.toneSearchHz; hz <= this.options.toneHz + this.options.toneSearchHz + 0.001; hz += step) {
      this.frequencies.push(hz);
    }
    this.metrics = this.emptyMetrics();
  }

  reset(): void {
    this.remainder = new Float32Array(0);
    this.totalSamples = 0;
    this.baseTimestampMs = null;
    this.keyed = false;
    this.onWindows = 0;
    this.offWindows = 0;
    this.noiseFloor = EPSILON;
    this.transitionsSeen = 0;
    this.lastTransitionSample = 0;
    this.metrics = this.emptyMetrics();
  }

  process(frame: Float32Array, timestampMs?: number): MorseToneResult {
    if (this.baseTimestampMs === null && Number.isFinite(timestampMs)) this.baseTimestampMs = timestampMs as number;
    const samples = this.joinFrame(frame);
    const transitions: MorseToneTransition[] = [];
    let consumed = 0;
    while (consumed + this.options.windowSamples <= samples.length) {
      const start = this.totalSamples + consumed;
      this.processWindow(samples.subarray(consumed, consumed + this.options.windowSamples), start, transitions);
      consumed += this.options.windowSamples;
    }
    this.totalSamples += consumed;
    this.remainder = samples.slice(consumed);
    return {
      detector: this,
      transitions,
      metrics: { ...this.metrics, sample: this.totalSamples },
      isKeyed: this.keyed,
      isMorseCandidate: this.transitionsSeen >= 2,
    };
  }

  private joinFrame(frame: Float32Array): Float32Array {
    if (this.remainder.length === 0) return frame;
    const joined = new Float32Array(this.remainder.length + frame.length);
    joined.set(this.remainder);
    joined.set(frame, this.remainder.length);
    return joined;
  }

  private processWindow(window: Float32Array, start: number, transitions: MorseToneTransition[]): void {
    let broadbandPower = 0;
    for (const sample of window) broadbandPower += sample * sample;
    broadbandPower /= window.length;

    let tonePower = 0;
    let toneHz = this.options.toneHz;
    for (const frequency of this.frequencies) {
      const power = this.goertzelPower(window, frequency);
      if (power > tonePower) {
        tonePower = power;
        toneHz = frequency;
      }
    }
    // Removing narrowband energy keeps a broadband reference from treating the target as noise.
    const residualNoise = Math.max(EPSILON, broadbandPower - tonePower);
    if (!this.keyed) this.noiseFloor = this.noiseFloor * 0.9 + residualNoise * 0.1;
    const noisePower = Math.max(EPSILON, this.noiseFloor, residualNoise * 0.25);
    const snrDb = 10 * Math.log10((tonePower + EPSILON) / noisePower);
    const onThreshold = this.options.minSnrDb;
    const offThreshold = onThreshold - this.options.hysteresisDb;
    const isTone = snrDb >= (this.keyed ? offThreshold : onThreshold);
    this.onWindows = isTone ? this.onWindows + 1 : 0;
    this.offWindows = isTone ? 0 : this.offWindows + 1;
    const confidence = Math.max(0, Math.min(1, (snrDb - offThreshold) / 20));

    if (!this.keyed && this.onWindows >= this.options.attackWindows) {
      this.keyed = true;
      this.offWindows = 0;
      this.emit("ON", start + this.options.windowSamples, confidence, transitions);
    } else if (this.keyed && this.offWindows >= this.options.releaseWindows) {
      this.keyed = false;
      this.onWindows = 0;
      this.emit("OFF", start + this.options.windowSamples, confidence, transitions);
    }
    this.metrics = { sample: start + this.options.windowSamples, toneHz, tonePower, noisePower, snrDb, threshold: onThreshold, transitionConfidence: confidence };
  }

  private emit(state: MorseKeyState, sample: number, confidence: number, transitions: MorseToneTransition[]): void {
    const durationSamples = this.transitionsSeen === 0 ? 0 : sample - this.lastTransitionSample;
    this.lastTransitionSample = sample;
    this.transitionsSeen += 1;
    transitions.push({
      state,
      sample,
      timestampMs: (this.baseTimestampMs ?? 0) + (sample * 1000) / this.options.sampleRate,
      durationSamples,
      confidence,
    });
  }

  private goertzelPower(samples: Float32Array, frequency: number): number {
    const omega = (2 * Math.PI * frequency) / this.options.sampleRate;
    const coefficient = 2 * Math.cos(omega);
    let previous = 0;
    let previous2 = 0;
    for (const sample of samples) {
      const current = sample + coefficient * previous - previous2;
      previous2 = previous;
      previous = current;
    }
    return (2 * (previous * previous + previous2 * previous2 - coefficient * previous * previous2)) / (samples.length * samples.length);
  }

  private emptyMetrics(): MorseToneMetrics {
    return { sample: 0, toneHz: this.options?.toneHz ?? 700, tonePower: 0, noisePower: EPSILON, snrDb: -Infinity, threshold: this.options?.minSnrDb ?? 9, transitionConfidence: 0 };
  }
}

export function createMorseToneDetector(options: MorseToneDetectorOptions): MorseToneDetector {
  return new MorseToneDetector(options);
}
