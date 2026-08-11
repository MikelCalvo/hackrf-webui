import type {
  AudioDemodMode,
  HardwareStatus,
  SignalLevelTelemetry,
  SpectrumFrame,
  StreamSessionSnapshot,
} from "@/lib/types";

const TRUE_VALUES = new Set(["1", "true", "yes", "y", "on", "sim", "simulator"]);
const SPECTRUM_BINS = 96;
const SILENT_MP3_CHUNK = Uint8Array.from(Buffer.from(
  "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYyLjEyLjEwMAAAAAAAAAAAAAAA//tAwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAFAAACwABoaGhoaGhoaGhoaGhoaGhoaGhojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo60tLS0tLS0tLS0tLS0tLS0tLS0tNra2tra2tra2tra2tra2tra2tra//////////////////////////8AAAAATGF2YzYyLjI4AAAAAAAAAAAAAAAAJAMGAAAAAAAAAsDztPdIAAAAAAD/+xDEAAPAAAGkAAAAIAAANIAAAARMQU1FMy4xMDEgKGJldGEgMylVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EsQpg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EMRTg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sSxH0DwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxKcDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=",
  "base64",
));

export type HackrfSimulatorEnv = Record<string, string | undefined>;

export type SimulatedAudioStream = {
  stream: ReadableStream<Uint8Array>;
  close: () => void;
};

export type SimulatedAudioStreamOptions = {
  signal?: AbortSignal;
  chunkIntervalMs?: number;
  onClose?: () => void;
  mode?: AudioDemodMode;
  onMorsePcm?: ((samples: Float32Array, sampleRate: number) => void) | null;
};

export function isHackrfSimulatorEnabled(env: HackrfSimulatorEnv = process.env): boolean {
  const value = env.HACKRF_WEBUI_SIMULATOR?.trim().toLowerCase();
  return value ? TRUE_VALUES.has(value) : false;
}

export function createSimulatedHardwareStatus(
  binaryPath: string,
  activeStream: StreamSessionSnapshot | null,
): HardwareStatus {
  return {
    state: "connected",
    cliAvailable: true,
    binaryAvailable: true,
    ffmpegAvailable: true,
    binaryPath,
    product: "HackRF Simulator",
    firmware: "simulated",
    hardware: "virtual",
    serial: "SIMULATED",
    message: activeStream
      ? `Simulator mode is streaming ${activeStream.label}. No physical HackRF is in use.`
      : "Simulator mode is enabled. FM/PMR/AIRBAND/MARITIME audio flows can run without a physical HackRF.",
    activeStream,
  };
}

export function createSimulatedTelemetry(freqHz: number, now = Date.now()): SignalLevelTelemetry {
  const seconds = now / 1000;
  const seed = (Math.abs(Math.round(freqHz / 1000)) % 997) / 997;
  const slow = (Math.sin(seconds * 0.75 + seed * Math.PI * 2) + 1) / 2;
  const fast = (Math.sin(seconds * 3.3 + seed * 11) + 1) / 2;
  const burst = slow > 0.58 ? slow : 0;
  const rms = roundMetric(4 + burst * 42 + fast * 5);
  const peak = roundMetric(Math.min(90, rms + 8 + fast * 10));
  const rf = roundMetric(Math.min(95, rms + 12 + slow * 18));

  return {
    rms,
    peak,
    rf,
    updatedAt: new Date(now).toISOString(),
  };
}

export function createSimulatedSpectrumFrame(
  freqHz: number,
  mode: AudioDemodMode,
  now = Date.now(),
): SpectrumFrame {
  const spanHz = mode === "wfm" ? 2_400_000 : mode === "am" ? 600_000 : mode === "cw" ? 25_000 : 200_000;
  const seed = (Math.abs(Math.round(freqHz / 1000)) % 251) / 251;
  const sweep = (Math.sin(now / 850 + seed * Math.PI * 2) + 1) / 2;
  const peakIndex = Math.max(0, Math.min(SPECTRUM_BINS - 1, Math.round((0.4 + sweep * 0.2) * (SPECTRUM_BINS - 1))));
  const bins = Array.from({ length: SPECTRUM_BINS }, (_, index) => {
    const distance = Math.abs(index - peakIndex);
    const carrier = Math.max(0, 42 - distance * 4.5);
    const shoulder = Math.max(0, 10 - Math.abs(index - SPECTRUM_BINS * 0.5) * 0.35);
    const noise = Math.sin(index * 1.7 + now / 300 + seed * 17) * 2.5;
    return roundMetric(-92 + carrier + shoulder + noise);
  });

  return {
    bins,
    centerFreqHz: freqHz,
    spanHz,
    peakIndex,
    updatedAt: new Date(now).toISOString(),
  };
}

export function createSimulatedAudioStream(options: SimulatedAudioStreamOptions = {}): SimulatedAudioStream {
  const chunkIntervalMs = Math.max(5, Math.min(1000, options.chunkIntervalMs ?? 100));
  const morseSampleRate = 10_000;
  let morseOffset = 0;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    options.signal?.removeEventListener("abort", close);
    try {
      controller?.close();
    } catch {
      // The consumer may already have cancelled the stream.
    }
    options.onClose?.();
  };

  const enqueue = () => {
    if (closed || !controller) {
      return;
    }
    try {
      controller.enqueue(SILENT_MP3_CHUNK.slice());
      if (options.onMorsePcm) {
        const sampleCount = Math.max(1, Math.round((morseSampleRate * chunkIntervalMs) / 1000));
        const samples = new Float32Array(sampleCount);
        const unitSamples = Math.round(morseSampleRate * 0.08);
        // Leading/trailing quiet time gives each deterministic SOS burst a clean reset.
        const pattern = [
          [0, 10],
          [1, 1], [0, 1], [1, 1], [0, 1], [1, 1], [0, 3],
          [1, 3], [0, 1], [1, 3], [0, 1], [1, 3], [0, 3],
          [1, 1], [0, 1], [1, 1], [0, 1], [1, 1], [0, 14],
        ] as const;
        const cycleSamples = pattern.reduce((total, [, units]) => total + units * unitSamples, 0);
        for (let index = 0; index < sampleCount; index += 1) {
          const absoluteSample = morseOffset + index;
          let position = absoluteSample % cycleSamples;
          let keyed = false;
          for (const [state, units] of pattern) {
            const length = units * unitSamples;
            if (position < length) {
              keyed = state === 1;
              break;
            }
            position -= length;
          }
          if (keyed) samples[index] = 0.7 * Math.sin((2 * Math.PI * 700 * absoluteSample) / morseSampleRate);
        }
        morseOffset += sampleCount;
        options.onMorsePcm(samples, morseSampleRate);
      }
    } catch {
      close();
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
      if (options.signal?.aborted) {
        close();
        return;
      }
      options.signal?.addEventListener("abort", close, { once: true });
      enqueue();
      timer = setInterval(enqueue, chunkIntervalMs);
    },
    cancel() {
      close();
    },
  }, {
    highWaterMark: 4,
  });

  return {
    stream,
    close,
  };
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}
