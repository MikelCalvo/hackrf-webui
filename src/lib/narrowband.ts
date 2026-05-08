import type { RadioChannel } from "@/lib/radio";
import type { NarrowbandSessionMode, RadioSessionChannel } from "@/lib/radio-session";
import { appendApiToken } from "@/lib/api-client";

export type NarrowbandUiScannerState = "idle" | "scanning" | "locked";

export function deriveNarrowbandScannerState(
  mode: NarrowbandSessionMode | null | undefined,
  state: string | null | undefined,
): NarrowbandUiScannerState {
  if (mode !== "scan" || !state || state === "error" || state === "stopped" || state === "stopping") {
    return "idle";
  }
  return state === "locked" ? "locked" : "scanning";
}

export function formatRadioSessionAudioUrl(sessionId: string): string {
  return appendApiToken(`/api/radio/sessions/${encodeURIComponent(sessionId)}/audio`);
}

export function toRadioSessionChannels<T extends RadioSessionChannel>(channels: T[]): RadioSessionChannel[] {
  return channels.map((channel) => ({
    id: channel.id,
    bandId: channel.bandId,
    number: channel.number,
    freqMhz: channel.freqMhz,
    label: channel.label,
    notes: channel.notes,
  }));
}

export function uniqueChannelsByLabelFrequency<T extends RadioChannel>(
  channels: T[],
  frequencyDigits = 3,
): T[] {
  const byKey = new Map<string, T>();

  for (const channel of channels) {
    const key = `${channel.freqMhz.toFixed(frequencyDigits)}:${channel.label}`;
    if (!byKey.has(key)) {
      byKey.set(key, channel);
    }
  }

  return [...byKey.values()]
    .sort((left, right) => left.freqMhz - right.freqMhz || left.label.localeCompare(right.label))
    .map((channel, index) => ({
      ...channel,
      number: index + 1,
    }));
}

export function uniqueChannelsByFrequency<T extends RadioChannel>(
  channels: T[],
  frequencyDigits = 5,
): T[] {
  const byFrequency = new Map<string, T>();

  for (const channel of channels) {
    const key = channel.freqMhz.toFixed(frequencyDigits);
    if (!byFrequency.has(key)) {
      byFrequency.set(key, channel);
    }
  }

  return [...byFrequency.values()].sort((left, right) => left.freqMhz - right.freqMhz);
}
