export type SpectrumViewRange = {
  minFreqHz: number;
  maxFreqHz: number;
};

type ChannelLike = {
  freqMhz: number;
};

export function buildChannelSpectrumRange(channels: ChannelLike[]): SpectrumViewRange | null {
  if (channels.length === 0) {
    return null;
  }

  const freqsHz = channels
    .map((channel) => Math.round(channel.freqMhz * 1_000_000))
    .filter((freqHz) => Number.isFinite(freqHz))
    .sort((a, b) => a - b);

  if (freqsHz.length === 0) {
    return null;
  }

  const minFreqHz = freqsHz[0];
  const maxFreqHz = freqsHz[freqsHz.length - 1];

  let minStepHz = Number.POSITIVE_INFINITY;
  for (let index = 1; index < freqsHz.length; index += 1) {
    const stepHz = freqsHz[index] - freqsHz[index - 1];
    if (stepHz > 0 && stepHz < minStepHz) {
      minStepHz = stepHz;
    }
  }

  const paddingHz = Number.isFinite(minStepHz)
    ? Math.max(6_250, Math.min(250_000, Math.round(minStepHz / 2)))
    : 25_000;

  return {
    minFreqHz: minFreqHz - paddingHz,
    maxFreqHz: maxFreqHz + paddingHz,
  };
}
