export type MorseState = "on" | "off";

export interface MorseTimingSample {
  state: MorseState;
  durationMs: number;
}

export type MorseGapKind = "intra-character" | "inter-character" | "inter-word";

export interface MorseGap {
  kind: MorseGapKind;
  durationMs: number;
  units: number;
  confidence: number;
}

export interface MorseCharacter {
  text: string;
  raw: string;
  confidence: number;
}

export interface MorseDecodeResult {
  text: string;
  dotDurationMs: number | null;
  wordsPerMinute: number | null;
  rawGroups: string[];
  gaps: MorseGap[];
  characters: MorseCharacter[];
  confidence: number;
  truncated: boolean;
}

const ITU_MORSE: Record<string, string> = {
  ".-": "A", "-...": "B", "-.-.": "C", "-..": "D", ".": "E", "..-.": "F", "--.": "G", "....": "H", "..": "I", ".---": "J",
  "-.-": "K", ".-..": "L", "--": "M", "-.": "N", "---": "O", ".--.": "P", "--.-": "Q", ".-.": "R", "...": "S", "-": "T", "..-": "U", "...-": "V", ".--": "W", "-..-": "X", "-.--": "Y", "--..": "Z",
  "-----": "0", ".----": "1", "..---": "2", "...--": "3", "....-": "4", ".....": "5", "-....": "6", "--...": "7", "---..": "8", "----.": "9",
  ".-.-.-": ".", "--..--": ",", "..--..": "?", "-..-.": "/", ".--.-.": "@", "-....-": "-", ".-..-.": "\"", ".----.": "'", "-.-.--": "!", "-.--.": "(", "-.--.-": ")", ".-...": "&", "---...": ":", "-.-.-.": ";", "-...-": "=", ".-.-.": "+", "..--.-": "_", "...-..-": "$",
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const timingConfidence = (durationMs: number, expectedUnits: number, dotDurationMs: number) =>
  clamp(1 - Math.abs(durationMs / dotDurationMs - expectedUnits) / expectedUnits);

export function decodeMorseTiming(input: readonly MorseTimingSample[]): MorseDecodeResult {
  const samples = input.filter((sample): sample is MorseTimingSample =>
    (sample.state === "on" || sample.state === "off") && Number.isFinite(sample.durationMs) && sample.durationMs > 0,
  );
  if (samples.length === 0) {
    return { text: "", dotDurationMs: null, wordsPerMinute: null, rawGroups: [], gaps: [], characters: [], confidence: 0, truncated: false };
  }

  const shortest = Math.min(...samples.map((sample) => sample.durationMs));
  const dotDurationMs = median(samples.map((sample) => sample.durationMs).filter((duration) => duration <= shortest * 1.8));
  const wordsPerMinute = 1200 / dotDurationMs;
  const rawGroups: string[] = [];
  const gaps: MorseGap[] = [];
  const characters: MorseCharacter[] = [];
  let outputText = "";
  let current = "";
  let currentMarkConfidences: number[] = [];
  let hasFinalCharacterGap = false;

  const completeCharacter = () => {
    if (!current) return;
    const characterText = ITU_MORSE[current] ?? "?";
    const confidence = characterText === "?" || currentMarkConfidences.length === 0
      ? 0
      : clamp(median(currentMarkConfidences));
    rawGroups.push(current);
    characters.push({ text: characterText, raw: current, confidence });
    outputText += characterText;
    current = "";
    currentMarkConfidences = [];
  };

  for (const sample of samples) {
    if (sample.state === "on") {
      const units = sample.durationMs / dotDurationMs;
      const expectedUnits = units < 2 ? 1 : 3;
      current += expectedUnits === 1 ? "." : "-";
      currentMarkConfidences.push(timingConfidence(sample.durationMs, expectedUnits, dotDurationMs));
      hasFinalCharacterGap = false;
      continue;
    }

    const units = sample.durationMs / dotDurationMs;
    if (units < 2) {
      gaps.push({ kind: "intra-character", durationMs: sample.durationMs, units: 1, confidence: timingConfidence(sample.durationMs, 1, dotDurationMs) });
      continue;
    }
    if (units < 5) {
      completeCharacter();
      gaps.push({ kind: "inter-character", durationMs: sample.durationMs, units: 3, confidence: timingConfidence(sample.durationMs, 3, dotDurationMs) });
      hasFinalCharacterGap = true;
      continue;
    }
    completeCharacter();
    if (rawGroups.at(-1) !== "/") rawGroups.push("/");
    if (outputText && !outputText.endsWith(" ")) outputText += " ";
    gaps.push({ kind: "inter-word", durationMs: sample.durationMs, units: 7, confidence: timingConfidence(sample.durationMs, 7, dotDurationMs) });
    hasFinalCharacterGap = true;
  }
  completeCharacter();

  const confidenceValues = [...characters.map((character) => character.confidence), ...gaps.map((gap) => gap.confidence)];
  return {
    text: outputText.trimEnd(),
    dotDurationMs,
    wordsPerMinute,
    rawGroups,
    gaps,
    characters,
    confidence: confidenceValues.length === 0
      ? 0
      : clamp(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length),
    truncated: samples.at(-1)?.state === "off" && !hasFinalCharacterGap,
  };
}
