import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";

import type {
  ActivityCaptureRequestMeta,
  AudioDemodMode,
  HardwareStatus,
  SignalLevelTelemetry,
  StreamRequest,
  StreamSessionSnapshot,
} from "@/lib/types";
import { TELEMETRY_REPORT_INTERVAL_MS } from "@/lib/signal-activity";
import { adsbRuntime } from "@/server/adsb-runtime";
import { persistCapturedActivity } from "@/server/activity-events";
import { hackrfDeviceService } from "@/server/hackrf-device";
import { aisRuntime } from "@/server/ais-runtime";
import { capturePrefixForSession } from "@/server/storage";

const LEVEL_RE = /LEVEL rms=([0-9.]+) peak=([0-9.]+) rf=([0-9.]+)/;
const RECORDING_OPEN_WAV_RE = /^Recording activity WAV: (.+)$/;
const RECORDING_OPEN_IQ_RE = /^Recording activity IQ: (.+)$/;
const RECORDING_SAVED_WAV_RE = /^Recording saved WAV: (.+)$/;
const RECORDING_SAVED_IQ_RE = /^Recording saved IQ: (.+)$/;
const RETUNE_SETTLE_MS = 450;

type CaptureDescriptor = {
  module: ActivityCaptureRequestMeta["module"];
  mode: ActivityCaptureRequestMeta["mode"];
  bandId: string | null;
  channelId: string | null;
  channelNumber: number | null;
  channelNotes: string | null;
  squelch: number | null;
  sourceMode: ActivityCaptureRequestMeta["sourceMode"];
  gpsdFallbackMode: ActivityCaptureRequestMeta["gpsdFallbackMode"];
  sourceStatus: ActivityCaptureRequestMeta["sourceStatus"];
  sourceDetail: string | null;
  regionId: string | null;
  regionName: string | null;
  countryId: string | null;
  countryCode: string | null;
  countryName: string | null;
  cityId: string | null;
  cityName: string | null;
  resolvedLatitude: number | null;
  resolvedLongitude: number | null;
  label: string;
  freqHz: number;
  demodMode: AudioDemodMode;
};

type PendingActivityCapture = {
  startedAtMs: number;
  descriptor: CaptureDescriptor;
  audioPath: string | null;
  iqPath: string | null;
  savedAudioPath: string | null;
  savedIqPath: string | null;
  finalizeTimer: ReturnType<typeof setTimeout> | null;
};

type StreamCaptureContext = {
  capturePrefix: string;
  descriptor: CaptureDescriptor;
  device: {
    label: string | null;
    serial: string | null;
    firmware: string | null;
    hardware: string | null;
  };
  rf: {
    lna: number;
    vga: number;
    audioGain: number;
  };
  pendingSegment: PendingActivityCapture | null;
};

type ActiveStream = {
  session: StreamSessionSnapshot;
  telemetry: SignalLevelTelemetry | null;
  hackrf: ReturnType<typeof spawn>;
  ffmpeg: ReturnType<typeof spawn>;
  retuneTimer: ReturnType<typeof setTimeout> | null;
  captureContext: StreamCaptureContext | null;
};

function audioRateForMode(mode: AudioDemodMode): string {
  switch (mode) {
    case "am":
    case "nfm":
    case "wfm":
    default:
      return "50000";
  }
}

function nativeBinaryPath(): string {
  return (
    process.env.HACKRF_WEBUI_NATIVE_BIN?.trim() ||
    path.join(/*turbopackIgnore: true*/ process.cwd(), "bin", "hackrf_audio_stream")
  );
}

function commandAvailable(command: string, args: string[] = ["-version"]): boolean {
  const result = spawnSync(command, args, {
    stdio: "ignore",
  });

  return !result.error;
}

function shortenSerial(serial: string): string {
  const compact = serial.replace(/\s+/g, "").trim();
  if (compact.length <= 12) {
    return compact;
  }

  return `${compact.slice(0, 6)}..${compact.slice(-6)}`;
}

function parseHackrfInfoOutput(output: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("Board ID Number:")) {
      parsed.board = line.split(":", 2)[1]?.trim() || "";
    } else if (line.startsWith("Firmware Version:")) {
      parsed.firmware = line.split(":", 2)[1]?.trim() || "";
    } else if (line.startsWith("Hardware Revision:")) {
      parsed.hardware = line.split(":", 2)[1]?.trim() || "";
    } else if (line.startsWith("Serial number:")) {
      parsed.serial = line.split(":", 2)[1]?.trim() || "";
    }
  }

  return parsed;
}

function readHackrfIdentity(): {
  label: string | null;
  serial: string | null;
  firmware: string | null;
  hardware: string | null;
} {
  const info = spawnSync("hackrf_info", [], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (info.error) {
    return {
      label: "HackRF One",
      serial: null,
      firmware: null,
      hardware: null,
    };
  }

  const output = `${info.stdout || ""}${info.stderr || ""}`;
  const parsed = parseHackrfInfoOutput(output);
  return {
    label: parsed.board || "HackRF One",
    serial: shortenSerial(parsed.serial || "") || null,
    firmware: parsed.firmware || null,
    hardware: parsed.hardware || null,
  };
}

class HackRFService {
  private activeStream: ActiveStream | null = null;

  getStatus(): HardwareStatus {
    const binaryPath = nativeBinaryPath();
    const binaryAvailable = existsSync(binaryPath);
    const ffmpegAvailable = commandAvailable("ffmpeg");
    const aisStatus = aisRuntime.getStatus();
    const aisActive = aisStatus.state === "running" || aisStatus.state === "starting";
    const adsbStatus = adsbRuntime.getStatus();
    const adsbActive = adsbStatus.state === "running" || adsbStatus.state === "starting";
    const info = spawnSync("hackrf_info", [], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const activeStream = this.activeSnapshot();
    if (!binaryAvailable) {
      return {
        state: "binary-missing",
        cliAvailable: !info.error,
        binaryAvailable,
        ffmpegAvailable,
        binaryPath,
        product: "HackRF One",
        firmware: "",
        hardware: "",
        serial: "",
        message: "The native binary is missing. Run npm run build:native.",
        activeStream,
      };
    }

    if (!ffmpegAvailable) {
      return {
        state: "ffmpeg-missing",
        cliAvailable: !info.error,
        binaryAvailable,
        ffmpegAvailable,
        binaryPath,
        product: "HackRF One",
        firmware: "",
        hardware: "",
        serial: "",
        message: "ffmpeg is not available on this system.",
        activeStream,
      };
    }

    if (info.error) {
      return {
        state: "cli-missing",
        cliAvailable: false,
        binaryAvailable,
        ffmpegAvailable,
        binaryPath,
        product: "HackRF One",
        firmware: "",
        hardware: "",
        serial: "",
        message: "hackrf_info or the HackRF runtime is missing.",
        activeStream,
      };
    }

    const output = `${info.stdout || ""}${info.stderr || ""}`;
    if (output.includes("No HackRF boards found.")) {
      return {
        state: "disconnected",
        cliAvailable: true,
        binaryAvailable,
        ffmpegAvailable,
        binaryPath,
        product: "HackRF One",
        firmware: "",
        hardware: "",
        serial: "",
        message: "HackRF not found. Connect the device over USB and try again.",
        activeStream,
      };
    }

    const parsed = parseHackrfInfoOutput(output);
    const serial = shortenSerial(parsed.serial || "");

    return {
      state: "connected",
      cliAvailable: true,
      binaryAvailable,
      ffmpegAvailable,
      binaryPath,
      product: parsed.board || "HackRF One",
      firmware: parsed.firmware || "",
      hardware: parsed.hardware || "",
      serial,
      message: activeStream
        ? `HackRF ready with an active stream on ${activeStream.label}.`
        : aisActive
          ? "HackRF dedicated to the live AIS decoder."
          : adsbActive
            ? "HackRF dedicated to the live ADS-B decoder."
          : "HackRF ready to tune.",
      activeStream,
    };
  }

  startWfmStream(request: StreamRequest, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    return this.startStreamInternal(request, "wfm", signal);
  }

  startNfmStream(request: StreamRequest, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    return this.startStreamInternal(request, "nfm", signal);
  }

  startAmStream(request: StreamRequest, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    return this.startStreamInternal(request, "am", signal);
  }

  /**
   * Retune the active audio stream to a new frequency without restarting any process.
   * Returns true if the command was sent, false if there is no compatible active stream.
   */
  retune(
    freqHz: number,
    label: string,
    mode?: AudioDemodMode,
    activityCapture?: ActivityCaptureRequestMeta | null,
  ): boolean {
    if (!this.activeStream) return false;
    if (mode && this.activeStream.session.demodMode !== mode) {
      return false;
    }
    const { hackrf } = this.activeStream;
    if (!hackrf.stdin?.writable) return false;
    hackrf.stdin.write(`FREQ ${freqHz}\n`);

    if (this.activeStream.retuneTimer) {
      clearTimeout(this.activeStream.retuneTimer);
      this.activeStream.retuneTimer = null;
    }

    this.activeStream.session.phase = "retuning";
    this.activeStream.session.phaseSince = new Date().toISOString();
    this.activeStream.session.pendingFreqHz = freqHz;
    this.activeStream.session.pendingLabel = label;

    const sessionId = this.activeStream.session.id;
    this.activeStream.retuneTimer = setTimeout(() => {
      if (!this.activeStream || this.activeStream.session.id !== sessionId) {
        return;
      }

      this.activeStream.session.freqHz = freqHz;
      this.activeStream.session.label = label;
      this.activeStream.session.phase = "running";
      this.activeStream.session.phaseSince = new Date().toISOString();
      this.activeStream.session.pendingFreqHz = null;
      this.activeStream.session.pendingLabel = null;
      this.activeStream.retuneTimer = null;

      if (this.activeStream.captureContext) {
        this.activeStream.captureContext.descriptor = {
          module: activityCapture?.module ?? this.activeStream.captureContext.descriptor.module,
          mode: activityCapture?.mode ?? this.activeStream.captureContext.descriptor.mode,
          bandId: activityCapture?.bandId ?? this.activeStream.captureContext.descriptor.bandId,
          channelId: activityCapture?.channelId ?? this.activeStream.captureContext.descriptor.channelId,
          channelNumber: activityCapture?.channelNumber ?? this.activeStream.captureContext.descriptor.channelNumber,
          channelNotes: activityCapture?.channelNotes ?? this.activeStream.captureContext.descriptor.channelNotes,
          squelch: activityCapture?.squelch ?? this.activeStream.captureContext.descriptor.squelch,
          sourceMode: activityCapture?.sourceMode ?? this.activeStream.captureContext.descriptor.sourceMode,
          gpsdFallbackMode:
            activityCapture?.gpsdFallbackMode ?? this.activeStream.captureContext.descriptor.gpsdFallbackMode,
          sourceStatus: activityCapture?.sourceStatus ?? this.activeStream.captureContext.descriptor.sourceStatus,
          sourceDetail: activityCapture?.sourceDetail ?? this.activeStream.captureContext.descriptor.sourceDetail,
          regionId: activityCapture?.regionId ?? this.activeStream.captureContext.descriptor.regionId,
          regionName: activityCapture?.regionName ?? this.activeStream.captureContext.descriptor.regionName,
          countryId: activityCapture?.countryId ?? this.activeStream.captureContext.descriptor.countryId,
          countryCode: activityCapture?.countryCode ?? this.activeStream.captureContext.descriptor.countryCode,
          countryName: activityCapture?.countryName ?? this.activeStream.captureContext.descriptor.countryName,
          cityId: activityCapture?.cityId ?? this.activeStream.captureContext.descriptor.cityId,
          cityName: activityCapture?.cityName ?? this.activeStream.captureContext.descriptor.cityName,
          resolvedLatitude:
            activityCapture?.resolvedLatitude ?? this.activeStream.captureContext.descriptor.resolvedLatitude,
          resolvedLongitude:
            activityCapture?.resolvedLongitude ?? this.activeStream.captureContext.descriptor.resolvedLongitude,
          label,
          freqHz,
          demodMode: this.activeStream.session.demodMode,
        };
      }
    }, RETUNE_SETTLE_MS);

    return true;
  }

  private async startStreamInternal(
    request: StreamRequest,
    mode: AudioDemodMode,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    await aisRuntime.stop();
    await adsbRuntime.stop();

    // Wait for the previous hackrf process to exit and release the USB device before
    // spawning a new one — avoids the race where hackrf_open() fails on a busy device.
    await this.stopAndWait();

    const binaryPath = nativeBinaryPath();
    if (!existsSync(binaryPath)) {
      throw new Error("The native binary is missing. Run npm run build:native.");
    }
    if (!commandAvailable("ffmpeg")) {
      throw new Error("ffmpeg is not available on this system.");
    }
    hackrfDeviceService.claim("audio", request.label);

    const sessionId = `stream-${Date.now()}`;
    const captureContext = this.buildCaptureContext(sessionId, request, mode);
    const session: StreamSessionSnapshot = {
      id: sessionId,
      label: request.label,
      freqHz: request.freqHz,
      demodMode: mode,
      startedAt: new Date().toISOString(),
      phase: "starting",
      phaseSince: new Date().toISOString(),
      lna: request.lna,
      vga: request.vga,
      audioGain: request.audioGain,
      pendingLabel: null,
      pendingFreqHz: null,
      telemetry: null,
    };

    const hackrf = spawn(
      binaryPath,
      [
        "-f",
        String(request.freqHz),
        "-m",
        mode,
        "-l",
        String(request.lna),
        "-g",
        String(request.vga),
        "-G",
        request.audioGain.toFixed(2),
        "-R",
        String(TELEMETRY_REPORT_INTERVAL_MS),
        ...(captureContext ? ["-P", captureContext.capturePrefix] : []),
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error",
        // Disable input buffering so ffmpeg starts encoding immediately
        "-fflags", "nobuffer", "-probesize", "32", "-analyzeduration", "0",
        "-f", "s16le", "-ar", audioRateForMode(mode), "-ac", "1", "-i", "pipe:0",
        "-f", "mp3", "-b:a", "128k",
        // Flush each MP3 frame to the pipe without waiting for an output buffer to fill
        "-flush_packets", "1",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    if (!hackrf.stdout || !hackrf.stderr || !ffmpeg.stdin || !ffmpeg.stdout || !ffmpeg.stderr) {
      hackrf.kill("SIGTERM");
      ffmpeg.kill("SIGTERM");
      hackrfDeviceService.release("audio");
      throw new Error("Could not initialize the local audio pipeline.");
    }

    hackrf.stdout.pipe(ffmpeg.stdin);
    this.attachTelemetry(hackrf.stderr, sessionId);

    ffmpeg.stderr.setEncoding("utf8");
    ffmpeg.stderr.on("data", () => {});

    const activeStream: ActiveStream = {
      session,
      telemetry: null,
      hackrf,
      ffmpeg,
      retuneTimer: null,
      captureContext,
    };
    this.activeStream = activeStream;

    const cleanup = () => {
      if (this.activeStream?.session.id !== sessionId) return;
      if (activeStream.retuneTimer) {
        clearTimeout(activeStream.retuneTimer);
        activeStream.retuneTimer = null;
      }
      if (activeStream.captureContext?.pendingSegment?.finalizeTimer) {
        clearTimeout(activeStream.captureContext.pendingSegment.finalizeTimer);
        activeStream.captureContext.pendingSegment.finalizeTimer = null;
      }
      hackrf.stdout?.unpipe(ffmpeg.stdin);
      try { ffmpeg.stdin?.end(); } catch { /* already gone */ }
      this.killProcess(hackrf);
      this.killProcess(ffmpeg);
      this.activeStream = null;
      hackrfDeviceService.release("audio");
    };

    signal.addEventListener("abort", cleanup, { once: true });
    hackrf.once("close", cleanup);
    ffmpeg.once("close", cleanup);

    activeStream.session.phase = "running";
    activeStream.session.phaseSince = new Date().toISOString();

    return Readable.toWeb(ffmpeg.stdout) as ReadableStream<Uint8Array>;
  }

  private activeSnapshot(): StreamSessionSnapshot | null {
    if (!this.activeStream) {
      return null;
    }

    return {
      ...this.activeStream.session,
      telemetry: this.activeStream.telemetry,
    };
  }

  private buildCaptureContext(
    sessionId: string,
    request: StreamRequest,
    mode: AudioDemodMode,
  ): StreamCaptureContext | null {
    if (!request.activityCapture) {
      return null;
    }

    const device = readHackrfIdentity();

    return {
      capturePrefix: capturePrefixForSession(request.activityCapture.module, sessionId),
      descriptor: {
        module: request.activityCapture.module,
        mode: request.activityCapture.mode,
        bandId: request.activityCapture.bandId ?? null,
        channelId: request.activityCapture.channelId ?? null,
        channelNumber: request.activityCapture.channelNumber ?? null,
        channelNotes: request.activityCapture.channelNotes ?? null,
        squelch: request.activityCapture.squelch ?? null,
        sourceMode: request.activityCapture.sourceMode ?? null,
        gpsdFallbackMode: request.activityCapture.gpsdFallbackMode ?? null,
        sourceStatus: request.activityCapture.sourceStatus ?? null,
        sourceDetail: request.activityCapture.sourceDetail ?? null,
        regionId: request.activityCapture.regionId ?? null,
        regionName: request.activityCapture.regionName ?? null,
        countryId: request.activityCapture.countryId ?? null,
        countryCode: request.activityCapture.countryCode ?? null,
        countryName: request.activityCapture.countryName ?? null,
        cityId: request.activityCapture.cityId ?? null,
        cityName: request.activityCapture.cityName ?? null,
        resolvedLatitude: request.activityCapture.resolvedLatitude ?? null,
        resolvedLongitude: request.activityCapture.resolvedLongitude ?? null,
        label: request.label,
        freqHz: request.freqHz,
        demodMode: mode,
      },
      device,
      rf: {
        lna: request.lna,
        vga: request.vga,
        audioGain: request.audioGain,
      },
      pendingSegment: null,
    };
  }

  private attachTelemetry(stderr: NodeJS.ReadableStream, sessionId: string): void {
    let buffer = "";
    stderr.setEncoding("utf8");
    stderr.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        const match = LEVEL_RE.exec(line);
        if (match && this.activeStream?.session.id === sessionId) {
          this.activeStream.telemetry = {
            rms: Number.parseFloat(match[1]),
            peak: Number.parseFloat(match[2]),
            rf: Number.parseFloat(match[3]),
            updatedAt: new Date().toISOString(),
          };
          continue;
        }

        const recordingOpenWav = RECORDING_OPEN_WAV_RE.exec(line);
        if (recordingOpenWav) {
          this.noteCapturePath(sessionId, "audio", recordingOpenWav[1]);
          continue;
        }

        const recordingOpenIq = RECORDING_OPEN_IQ_RE.exec(line);
        if (recordingOpenIq) {
          this.noteCapturePath(sessionId, "raw_iq", recordingOpenIq[1]);
          continue;
        }

        const recordingSavedWav = RECORDING_SAVED_WAV_RE.exec(line);
        if (recordingSavedWav) {
          this.noteSavedCapturePath(sessionId, "audio", recordingSavedWav[1]);
          continue;
        }

        const recordingSavedIq = RECORDING_SAVED_IQ_RE.exec(line);
        if (recordingSavedIq) {
          this.noteSavedCapturePath(sessionId, "raw_iq", recordingSavedIq[1]);
        }
      }
    });
  }

  private noteCapturePath(
    sessionId: string,
    kind: "audio" | "raw_iq",
    absolutePath: string,
  ): void {
    if (this.activeStream?.session.id !== sessionId || !this.activeStream.captureContext) {
      return;
    }

    const context = this.activeStream.captureContext;
    const pending = context.pendingSegment ?? {
      startedAtMs: Date.now(),
      descriptor: { ...context.descriptor },
      audioPath: null,
      iqPath: null,
      savedAudioPath: null,
      savedIqPath: null,
      finalizeTimer: null,
    };

    if (kind === "audio") {
      pending.audioPath = absolutePath;
    } else {
      pending.iqPath = absolutePath;
    }

    context.pendingSegment = pending;
  }

  private noteSavedCapturePath(
    sessionId: string,
    kind: "audio" | "raw_iq",
    absolutePath: string,
  ): void {
    if (this.activeStream?.session.id !== sessionId || !this.activeStream.captureContext) {
      return;
    }

    const context = this.activeStream.captureContext;
    const pending = context.pendingSegment ?? {
      startedAtMs: Date.now(),
      descriptor: { ...context.descriptor },
      audioPath: null,
      iqPath: null,
      savedAudioPath: null,
      savedIqPath: null,
      finalizeTimer: null,
    };

    if (kind === "audio") {
      pending.savedAudioPath = absolutePath;
      pending.audioPath = pending.audioPath ?? absolutePath;
    } else {
      pending.savedIqPath = absolutePath;
      pending.iqPath = pending.iqPath ?? absolutePath;
    }

    if (pending.finalizeTimer) {
      clearTimeout(pending.finalizeTimer);
    }

    pending.finalizeTimer = setTimeout(() => {
      this.persistPendingCapture(sessionId);
    }, 120);

    context.pendingSegment = pending;
  }

  private persistPendingCapture(sessionId: string): void {
    if (this.activeStream?.session.id !== sessionId || !this.activeStream.captureContext?.pendingSegment) {
      return;
    }

    const context = this.activeStream.captureContext;
    const pending = context.pendingSegment;
    if (!pending) {
      return;
    }
    context.pendingSegment = null;

    if (pending.finalizeTimer) {
      clearTimeout(pending.finalizeTimer);
    }

    if (!pending.savedAudioPath && !pending.savedIqPath) {
      return;
    }

    persistCapturedActivity({
      module: pending.descriptor.module,
      mode: pending.descriptor.mode,
      label: pending.descriptor.label,
      freqHz: pending.descriptor.freqHz,
      demodMode: pending.descriptor.demodMode,
      bandId: pending.descriptor.bandId,
      channelId: pending.descriptor.channelId,
      channelNumber: pending.descriptor.channelNumber,
      startedAtMs: pending.startedAtMs,
      endedAtMs: Date.now(),
      rms: this.activeStream.telemetry?.rms ?? null,
      squelch: pending.descriptor.squelch ?? null,
      audioAbsolutePath: pending.savedAudioPath ?? pending.audioPath,
      iqAbsolutePath: pending.savedIqPath ?? pending.iqPath,
      deviceLabel: context.device.label,
      deviceSerial: context.device.serial,
      location: {
        sourceMode: pending.descriptor.sourceMode ?? null,
        gpsdFallbackMode: pending.descriptor.gpsdFallbackMode ?? null,
        sourceStatus: pending.descriptor.sourceStatus ?? null,
        sourceDetail: pending.descriptor.sourceDetail ?? null,
        catalogScope: {
          regionId: pending.descriptor.regionId ?? null,
          regionName: pending.descriptor.regionName ?? null,
          countryId: pending.descriptor.countryId ?? null,
          countryCode: pending.descriptor.countryCode ?? null,
          countryName: pending.descriptor.countryName ?? null,
          cityId: pending.descriptor.cityId ?? null,
          cityName: pending.descriptor.cityName ?? null,
        },
        resolvedPosition:
          pending.descriptor.resolvedLatitude !== null && pending.descriptor.resolvedLongitude !== null
            ? {
              latitude: pending.descriptor.resolvedLatitude,
              longitude: pending.descriptor.resolvedLongitude,
            }
            : null,
      },
      metadata: {
        captureSource: "native-activity",
        sessionId,
        channel: {
          label: pending.descriptor.label,
          bandId: pending.descriptor.bandId,
          channelId: pending.descriptor.channelId,
          channelNumber: pending.descriptor.channelNumber,
          notes: pending.descriptor.channelNotes,
        },
        rf: {
          ...context.rf,
          squelch: pending.descriptor.squelch ?? null,
        },
        device: context.device,
        sourceContext: {
          sourceMode: pending.descriptor.sourceMode ?? null,
          gpsdFallbackMode: pending.descriptor.gpsdFallbackMode ?? null,
          sourceStatus: pending.descriptor.sourceStatus ?? null,
          sourceDetail: pending.descriptor.sourceDetail ?? null,
        },
      },
    });
  }

  private stopAndWait(): Promise<void> {
    if (!this.activeStream) return Promise.resolve();

    const { hackrf, ffmpeg, retuneTimer, captureContext } = this.activeStream;
    this.activeStream = null;
    hackrfDeviceService.release("audio");

    if (retuneTimer) {
      clearTimeout(retuneTimer);
    }
    if (captureContext?.pendingSegment?.finalizeTimer) {
      clearTimeout(captureContext.pendingSegment.finalizeTimer);
    }

    // Register the wait listener before sending SIGTERM so we cannot miss the close event
    const released =
      hackrf.exitCode !== null || hackrf.killed
        ? Promise.resolve()
        : new Promise<void>(resolve => hackrf.once("close", resolve));

    this.killProcess(hackrf);
    this.killProcess(ffmpeg);

    return released;
  }

  private killProcess(processRef: ReturnType<typeof spawn>): void {
    if (processRef.killed || processRef.exitCode !== null) {
      return;
    }

    processRef.kill("SIGTERM");
    setTimeout(() => {
      if (!processRef.killed && processRef.exitCode === null) {
        processRef.kill("SIGKILL");
      }
    }, 150);
  }
}

declare global {
  var __hackrfWebUiService: HackRFService | undefined;
}

export const hackrfService =
  global.__hackrfWebUiService ?? new HackRFService();

if (process.env.NODE_ENV !== "production") {
  global.__hackrfWebUiService = hackrfService;
}
