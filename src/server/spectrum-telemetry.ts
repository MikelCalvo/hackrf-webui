import type { SpectrumFrame } from "@/lib/types";

const SPECTRUM_RE = /^SPECTRUM center=([0-9]+) span=([0-9]+) peak=([0-9]+) bins=(.+)$/;

export function parseSpectrumFrameLine(line: string): SpectrumFrame | null {
  const match = SPECTRUM_RE.exec(line.trim());
  if (!match) {
    return null;
  }

  const bins = match[4]
    .split(",")
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));

  if (bins.length === 0) {
    return null;
  }

  return {
    bins,
    centerFreqHz: Number.parseInt(match[1], 10),
    spanHz: Number.parseInt(match[2], 10),
    peakIndex: Number.parseInt(match[3], 10),
    updatedAt: new Date().toISOString(),
  };
}
