export type MorseFixtureState = "on" | "off";

export interface MorseFixtureTimingSample {
  state: MorseFixtureState;
  durationMs: number;
}

export interface MorseTimingOptions {
  dotMs?: number;
  wpm?: number;
  farnsworthWpm?: number;
}

export interface MorseTimingFixture {
  text: string;
  unsupported: number;
  dotMs: number;
  wordsPerMinute: number;
  characterGapMs: number;
  wordGapMs: number;
  samples: MorseFixtureTimingSample[];
}

export interface PcmFixtureOptions {
  sampleRate?: number;
  toneHz?: number;
  amplitude?: number;
  durationMs?: number;
  dotMs?: number;
  wpm?: number;
  farnsworthWpm?: number;
  frequencyOffsetHz?: number;
  frequencyDriftHz?: number;
  snrDb?: number;
  /** Deterministic seed for white noise; `noiseSeed` is retained as a descriptive alias. */
  seed?: number;
  noiseSeed?: number;
  fadeMs?: number;
  leadingSilenceMs?: number;
  trailingSilenceMs?: number;
  chunkSamples?: number;
}

export interface PcmFixture {
  pcm: Float32Array;
  chunks: Float32Array[];
  sampleRate: number;
  toneHz: { start: number; end: number };
  timing?: MorseTimingFixture;
}

const ITU_MORSE: Readonly<Record<string, string>> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---",
  K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
  0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----.",
  ".": ".-.-.-", ",": "--..--", "?": "..--..", "/": "-..-.", "@": ".--.-.", "-": "-....-", "\"": ".-..-.", "'": ".----.", "!": "-.-.--", "(": "-.--.", ")": "-.--.-", "&": ".-...", ":": "---...", ";": "-.-.-.", "=": "-...-", "+": ".-.-.", "_": "..--.-", "$": "...-..-",
};

const MAX_SAMPLES = 2_000_000;
const DEFAULT_SAMPLE_RATE = 8_000;
const DEFAULT_TONE_HZ = 700;
const DEFAULT_AMPLITUDE = 0.5;

const finitePositive = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) && value! > 0 ? value! : fallback;

const bounded = (value: number | undefined, fallback: number, min: number, max: number) =>
  Math.min(max, Math.max(min, finitePositive(value, fallback)));

const millisecondsToSamples = (milliseconds: number, sampleRate: number) => Math.round(milliseconds * sampleRate / 1_000);

const chunk = (pcm: Float32Array, chunkSamples?: number) => {
  const size = chunkSamples === undefined ? pcm.length : Math.max(1, Math.floor(chunkSamples));
  const chunks: Float32Array[] = [];
  for (let offset = 0; offset < pcm.length; offset += size) chunks.push(pcm.slice(offset, offset + size));
  return chunks;
};

const seededRandom = (seed: number) => {
  let state = (Math.floor(seed) >>> 0) || 0x6d2b79f5;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value = (value + Math.imul(value ^ value >>> 7, 61 | value)) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
};

export function encodeMorseTiming(input: string, options: MorseTimingOptions = {}): MorseTimingFixture {
  const dotMs = bounded(options.dotMs ?? (options.wpm ? 1_200 / options.wpm : undefined), 60, 1, 10_000);
  const wordsPerMinute = 1_200 / dotMs;
  const spacingScale = options.farnsworthWpm === undefined
    ? 1
    : Math.max(1, wordsPerMinute / bounded(options.farnsworthWpm, wordsPerMinute, 1, wordsPerMinute));
  const characterGapMs = 3 * dotMs * spacingScale;
  const wordGapMs = 7 * dotMs * spacingScale;
  let unsupported = 0;
  const characters = [...input.toUpperCase()].map((character) => {
    if (character === " ") return " ";
    if (ITU_MORSE[character]) return character;
    unsupported += 1;
    return "?";
  });
  const text = characters.join("").replace(/ +/g, " ").trim();
  const samples: MorseFixtureTimingSample[] = [];
  const appendOff = (durationMs: number) => {
    if (samples.at(-1)?.state === "off") samples.at(-1)!.durationMs += durationMs;
    else samples.push({ state: "off", durationMs });
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === " ") {
      if (samples.length > 0) {
        const previousGap = samples.at(-1)?.state === "off" ? samples.pop()!.durationMs : 0;
        appendOff(Math.max(0, wordGapMs - previousGap));
      }
      continue;
    }
    const code = ITU_MORSE[character];
    for (let mark = 0; mark < code.length; mark += 1) {
      samples.push({ state: "on", durationMs: dotMs * (code[mark] === "." ? 1 : 3) });
      if (mark < code.length - 1) appendOff(dotMs);
    }
    const next = text[index + 1];
    if (next && next !== " ") appendOff(characterGapMs);
  }
  return { text, unsupported, dotMs, wordsPerMinute, characterGapMs, wordGapMs, samples };
}

const normalizePcmOptions = (options: PcmFixtureOptions) => ({
  sampleRate: Math.floor(bounded(options.sampleRate, DEFAULT_SAMPLE_RATE, 1, 384_000)),
  toneHz: bounded(options.toneHz, DEFAULT_TONE_HZ, 0.001, 100_000),
  amplitude: Math.min(1, bounded(options.amplitude, DEFAULT_AMPLITUDE, 0.000001, 1)),
  frequencyOffsetHz: Number.isFinite(options.frequencyOffsetHz) ? options.frequencyOffsetHz! : 0,
  frequencyDriftHz: Number.isFinite(options.frequencyDriftHz) ? options.frequencyDriftHz! : 0,
  fadeMs: Math.max(0, Number.isFinite(options.fadeMs) ? options.fadeMs! : 0),
  leadingSilenceMs: Math.max(0, Number.isFinite(options.leadingSilenceMs) ? options.leadingSilenceMs! : 0),
  trailingSilenceMs: Math.max(0, Number.isFinite(options.trailingSilenceMs) ? options.trailingSilenceMs! : 0),
  snrDb: Number.isFinite(options.snrDb) ? options.snrDb! : undefined,
  noiseSeed: Number.isFinite(options.noiseSeed) ? options.noiseSeed! : (Number.isFinite(options.seed) ? options.seed! : 1),
});

function renderPcm(
  states: readonly boolean[],
  options: PcmFixtureOptions,
  timing?: MorseTimingFixture,
): PcmFixture {
  const config = normalizePcmOptions(options);
  if (states.length > MAX_SAMPLES) throw new RangeError(`Fixture exceeds ${MAX_SAMPLES} samples`);
  const pcm = new Float32Array(states.length);
  const random = seededRandom(config.noiseSeed);
  const noiseAmplitude = config.snrDb === undefined ? 0 : config.amplitude / 10 ** (config.snrDb / 20);
  const fadeSamples = millisecondsToSamples(config.fadeMs, config.sampleRate);
  let phase = 0;
  let activeSamples = 0;
  for (const active of states) if (active) activeSamples += 1;
  let activeIndex = 0;
  for (let index = 0; index < pcm.length; index += 1) {
    if (!states[index]) continue;
    const progress = activeSamples <= 1 ? 0 : activeIndex / (activeSamples - 1);
    const frequency = config.toneHz + config.frequencyOffsetHz + config.frequencyDriftHz * progress;
    const edge = Math.min(activeIndex, activeSamples - 1 - activeIndex);
    const envelope = fadeSamples === 0 ? 1 : Math.min(1, edge / fadeSamples);
    const noise = noiseAmplitude === 0 ? 0 : (random() * 2 - 1) * noiseAmplitude;
    pcm[index] = Math.max(-1, Math.min(1, (Math.sin(phase) * config.amplitude + noise) * envelope));
    phase += 2 * Math.PI * frequency / config.sampleRate;
    activeIndex += 1;
  }
  return {
    pcm,
    chunks: chunk(pcm, options.chunkSamples),
    sampleRate: config.sampleRate,
    toneHz: { start: config.toneHz + config.frequencyOffsetHz, end: config.toneHz + config.frequencyOffsetHz + config.frequencyDriftHz },
    timing,
  };
}

export function createMorsePcm(text: string, options: PcmFixtureOptions = {}): PcmFixture {
  const timing = encodeMorseTiming(text, options);
  const sampleRate = Math.floor(bounded(options.sampleRate, DEFAULT_SAMPLE_RATE, 1, 384_000));
  const states: boolean[] = [];
  const append = (active: boolean, durationMs: number) => {
    const length = millisecondsToSamples(durationMs, sampleRate);
    if (states.length + length > MAX_SAMPLES) throw new RangeError(`Fixture exceeds ${MAX_SAMPLES} samples`);
    for (let index = 0; index < length; index += 1) states.push(active);
  };
  append(false, Math.max(0, options.leadingSilenceMs ?? 0));
  for (const sample of timing.samples) append(sample.state === "on", sample.durationMs);
  append(false, Math.max(0, options.trailingSilenceMs ?? 0));
  return renderPcm(states, options, timing);
}

export function createContinuousTonePcm(options: PcmFixtureOptions = {}): PcmFixture {
  const sampleRate = Math.floor(bounded(options.sampleRate, DEFAULT_SAMPLE_RATE, 1, 384_000));
  const durationMs = bounded(options.durationMs, 1_000, 0.001, MAX_SAMPLES * 1_000 / sampleRate);
  return renderPcm(Array(millisecondsToSamples(durationMs, sampleRate)).fill(true), options);
}

export function createNoisePcm(options: PcmFixtureOptions = {}): PcmFixture {
  const sampleRate = Math.floor(bounded(options.sampleRate, DEFAULT_SAMPLE_RATE, 1, 384_000));
  const durationMs = bounded(options.durationMs, 1_000, 0.001, MAX_SAMPLES * 1_000 / sampleRate);
  const config = normalizePcmOptions(options);
  const pcm = new Float32Array(millisecondsToSamples(durationMs, sampleRate));
  const random = seededRandom(config.noiseSeed);
  for (let index = 0; index < pcm.length; index += 1) pcm[index] = (random() * 2 - 1) * config.amplitude;
  return { pcm, chunks: chunk(pcm, options.chunkSamples), sampleRate, toneHz: { start: 0, end: 0 } };
}
