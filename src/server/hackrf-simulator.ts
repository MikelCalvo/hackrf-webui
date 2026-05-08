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
  const spanHz = mode === "wfm" ? 2_400_000 : mode === "am" ? 600_000 : 200_000;
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
