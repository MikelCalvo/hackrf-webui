import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";

import type {
  ActivityCaptureRequestMeta,
  AudioDemodMode,
  HardwareStatus,
  SignalLevelTelemetry,
  SpectrumFeedSnapshot,
  SpectrumFrame,
  StreamRequest,
  StreamSessionSnapshot,
} from "@/lib/types";
import { TELEMETRY_REPORT_INTERVAL_MS } from "@/lib/signal-activity";
import { adsbRuntime } from "@/server/adsb-runtime";
import { persistCapturedActivity } from "@/server/activity-events";
import { hackrfDeviceService } from "@/server/hackrf-device";
import { aisRuntime } from "@/server/ais-runtime";
import { projectBinPath } from "@/server/project-paths";
import { parseSpectrumFrameLine } from "@/server/spectrum-telemetry";
import { capturePrefixForSession } from "@/server/storage";

const LEVEL_RE = /LEVEL rms=([0-9.]+) peak=([0-9.]+) rf=([0-9.]+)/;
const RECORDING_OPEN_WAV_RE = /^Recording activity WAV: (.+)$/;
const RECORDING_OPEN_IQ_RE = /^Recording activity IQ: (.+)$/;
const RECORDING_SAVED_WAV_RE = /^Recording saved WAV: (.+)$/;
const RECORDING_SAVED_IQ_RE = /^Recording saved IQ: (.+)$/;
const RETUNED_RE = /^RETUNED target=([0-9.]+) MHz tuned=([0-9.]+) MHz$/;
const RETUNE_FAILED_RE = /^RETUNE_FAILED target=([0-9.]+) MHz error=(.+)$/;
const RETUNE_SETTLE_MS = 450;
const CAPTURE_FINALIZE_SETTLE_MS = 400;

type CaptureDescriptor = {
  module: ActivityCaptureRequestMeta["module"];
  mode: ActivityCaptureRequestMeta["mode"];
  activityEventId: string | null;
  burstEventId: string | null;
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
  rmsSum: number;
  rmsCount: number;
  rmsPeak: number | null;
  peakPeak: number | null;
  rfPeak: number | null;
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
  spectrum: SpectrumFrame | null;
  hackrf: ReturnType<typeof spawn>;
  ffmpeg: ReturnType<typeof spawn>;
  retuneTimer: ReturnType<typeof setTimeout> | null;
  retuneDescriptorRollback: CaptureDescriptor | null;
  pendingRetuneDescriptor: CaptureDescriptor | null;
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
  const customPath = process.env.HACKRF_WEBUI_NATIVE_BIN?.trim();
  return customPath ? path.resolve(customPath) : projectBinPath("hackrf_audio_stream");
}

function commandAvailable(command: string, args: string[] = ["-version"]): boolean {
  const result = spawnSync(command, args, {
    stdio: "ignore",
  });

  return !result.error;
}

// Cache results that never change at runtime so getStatus() doesn't block
// the event loop on every hardware poll during scanning.
let _binaryAvailableCache: boolean | null = null;
let _ffmpegAvailableCache: boolean | null = null;

function cachedBinaryAvailable(): boolean {
  if (_binaryAvailableCache === null) {
    _binaryAvailableCache = existsSync(nativeBinaryPath());
  }
  return _binaryAvailableCache;
}

function cachedFfmpegAvailable(): boolean {
  if (_ffmpegAvailableCache === null) {
    _ffmpegAvailableCache = commandAvailable("ffmpeg");
  }
  return _ffmpegAvailableCache;
}

// Cache hackrf_info output — re-probe at most once every 5 s and never
// while a stream is active (the device is busy and we already know it works).
const HACKRF_INFO_CACHE_MS = 5000;
let _hackrfInfoCache: { output: string; error: boolean; at: number } | null = null;

// Cache the device identity read during stream startup.  The serial number and
// firmware version never change while the device is connected, so we can reuse
// the result across stream restarts without re-running hackrf_info.
let _hackrfIdentityCache: ReturnType<typeof readHackrfIdentity> | null = null;

function invalidateHackrfIdentityCache(): void {
  _hackrfIdentityCache = null;
}

function getCachedHackrfInfo(forceRefresh = false): { output: string; error: boolean } {
  const now = Date.now();
  if (!forceRefresh && _hackrfInfoCache && now - _hackrfInfoCache.at < HACKRF_INFO_CACHE_MS) {
    return { output: _hackrfInfoCache.output, error: _hackrfInfoCache.error };
  }
  const info = spawnSync("hackrf_info", [], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const result = {
    output: `${(info.stdout as string) || ""}${(info.stderr as string) || ""}`,
    error: !!info.error,
  };
  _hackrfInfoCache = { ...result, at: now };
  return result;
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

function cachedHackrfIdentity(): ReturnType<typeof readHackrfIdentity> {
  if (_hackrfIdentityCache === null) {
    _hackrfIdentityCache = readHackrfIdentity();
  }
  return _hackrfIdentityCache;
}

function createPendingSegment(descriptor: CaptureDescriptor): PendingActivityCapture {
  return {
    startedAtMs: Date.now(),
    descriptor: { ...descriptor },
    audioPath: null,
    iqPath: null,
    savedAudioPath: null,
    savedIqPath: null,
    rmsSum: 0,
    rmsCount: 0,
    rmsPeak: null,
    peakPeak: null,
    rfPeak: null,
    finalizeTimer: null,
  };
}

class HackRFService {
  private activeStream: ActiveStream | null = null;

  private flushPendingCapture(sessionId: string): void {
    if (this.activeStream?.session.id !== sessionId) {
      return;
    }

    const pending = this.activeStream.captureContext?.pendingSegment ?? null;
    if (!pending) {
      return;
    }

    if (pending.finalizeTimer) {
      clearTimeout(pending.finalizeTimer);
      pending.finalizeTimer = null;
    }

    if (!pending.savedAudioPath && !pending.savedIqPath) {
      return;
    }

    try {
      this.persistPendingCapture(sessionId);
    } catch (error) {
      console.error("[hackrf] Failed to flush pending capture:", error);
    }
  }

  private updateCaptureDescriptor(
    activityCapture: ActivityCaptureRequestMeta | null | undefined,
    label: string,
    freqHz: number,
    updatePendingSegment = false,
  ): void {
    const nextDescriptor = this.buildCaptureDescriptor(activityCapture, label, freqHz);
    if (!nextDescriptor || !this.activeStream?.captureContext) {
      return;
    }

    this.activeStream.captureContext.descriptor = nextDescriptor;
    if (updatePendingSegment && this.activeStream.captureContext.pendingSegment) {
      this.activeStream.captureContext.pendingSegment.descriptor = {
        ...this.activeStream.captureContext.pendingSegment.descriptor,
        ...nextDescriptor,
      };
    }
  }

  private buildCaptureDescriptor(
    activityCapture: ActivityCaptureRequestMeta | null | undefined,
    label: string,
    freqHz: number,
  ): CaptureDescriptor | null {
    if (!this.activeStream?.captureContext) {
      return null;
    }

    const previous = this.activeStream.captureContext.descriptor;
    return activityCapture
      ? {
        module: activityCapture.module,
        mode: activityCapture.mode,
        activityEventId: activityCapture.activityEventId ?? null,
        burstEventId: activityCapture.burstEventId ?? null,
        bandId: activityCapture.bandId ?? null,
        channelId: activityCapture.channelId ?? null,
        channelNumber: activityCapture.channelNumber ?? null,
        channelNotes: activityCapture.channelNotes ?? null,
        squelch: activityCapture.squelch ?? null,
        sourceMode: activityCapture.sourceMode ?? null,
        gpsdFallbackMode: activityCapture.gpsdFallbackMode ?? null,
        sourceStatus: activityCapture.sourceStatus ?? null,
        sourceDetail: activityCapture.sourceDetail ?? null,
        regionId: activityCapture.regionId ?? null,
        regionName: activityCapture.regionName ?? null,
        countryId: activityCapture.countryId ?? null,
        countryCode: activityCapture.countryCode ?? null,
        countryName: activityCapture.countryName ?? null,
        cityId: activityCapture.cityId ?? null,
        cityName: activityCapture.cityName ?? null,
        resolvedLatitude: activityCapture.resolvedLatitude ?? null,
        resolvedLongitude: activityCapture.resolvedLongitude ?? null,
        label,
        freqHz,
        demodMode: this.activeStream.session.demodMode,
      }
      : {
        ...previous,
        label,
        freqHz,
        demodMode: this.activeStream.session.demodMode,
      };
  }

  private completeRetuneSuccess(sessionId: string, freqHz: number, label: string): void {
    if (!this.activeStream || this.activeStream.session.id !== sessionId) {
      return;
    }

    if (this.activeStream.retuneTimer) {
      clearTimeout(this.activeStream.retuneTimer);
      this.activeStream.retuneTimer = null;
    }

    if (this.activeStream.captureContext && this.activeStream.pendingRetuneDescriptor) {
      this.activeStream.captureContext.descriptor = { ...this.activeStream.pendingRetuneDescriptor };
    }

    this.activeStream.session.freqHz = freqHz;
    this.activeStream.session.label = label;
    this.activeStream.session.phase = "running";
    this.activeStream.session.phaseSince = new Date().toISOString();
    this.activeStream.session.pendingFreqHz = null;
    this.activeStream.session.pendingLabel = null;
    this.activeStream.retuneDescriptorRollback = null;
    this.activeStream.pendingRetuneDescriptor = null;
  }

  private completeRetuneFailure(sessionId: string): void {
    if (!this.activeStream || this.activeStream.session.id !== sessionId) {
      return;
    }

    if (this.activeStream.retuneTimer) {
      clearTimeout(this.activeStream.retuneTimer);
      this.activeStream.retuneTimer = null;
    }

    if (this.activeStream.captureContext && this.activeStream.retuneDescriptorRollback) {
      this.activeStream.captureContext.descriptor = { ...this.activeStream.retuneDescriptorRollback };
    }

    this.activeStream.session.phase = "running";
    this.activeStream.session.phaseSince = new Date().toISOString();
    this.activeStream.session.pendingFreqHz = null;
    this.activeStream.session.pendingLabel = null;
    this.activeStream.retuneDescriptorRollback = null;
    this.activeStream.pendingRetuneDescriptor = null;
  }

  getStatus(): HardwareStatus {
    const binaryPath = nativeBinaryPath();
    const binaryAvailable = cachedBinaryAvailable();
    const ffmpegAvailable = cachedFfmpegAvailable();
    const aisStatus = aisRuntime.getStatus();
    const aisActive = aisStatus.state === "running" || aisStatus.state === "starting";
    const adsbStatus = adsbRuntime.getStatus();
    const adsbActive = adsbStatus.state === "running" || adsbStatus.state === "starting";

    // Skip hackrf_info entirely when a stream is active — the device is in use
    // and we already know it is connected.  Use a cache otherwise to avoid
    // blocking the event loop with a synchronous process spawn on every poll.
    const skipProbe = !!this.activeStream;
    const info = skipProbe
      ? { output: _hackrfInfoCache?.output ?? "", error: false }
      : getCachedHackrfInfo();

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

    const output = info.output;
    if (!skipProbe && output.includes("No HackRF boards found.")) {
      invalidateHackrfIdentityCache();
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
    expectedSessionId?: string | null,
  ): boolean {
    if (!this.activeStream) return false;
    if (expectedSessionId && this.activeStream.session.id !== expectedSessionId) {
      return false;
    }
    if (mode && this.activeStream.session.demodMode !== mode) {
      return false;
    }
    if (
      activityCapture?.module
      && this.activeStream.captureContext?.descriptor.module !== activityCapture.module
    ) {
      return false;
    }
    if (this.activeStream.session.pendingFreqHz !== null) {
      return false;
    }

    const previousDescriptor = this.activeStream.captureContext
      ? { ...this.activeStream.captureContext.descriptor }
      : null;
    const sameTarget =
      this.activeStream.session.freqHz === freqHz
      && this.activeStream.session.label === label
      && this.activeStream.session.pendingFreqHz === null
      && this.activeStream.session.pendingLabel === null;

    if (sameTarget) {
      const shouldUpdatePendingSegment = Boolean(
        activityCapture
        && (
          (
            activityCapture.activityEventId !== null
            && activityCapture.activityEventId !== undefined
          )
          || (
            activityCapture.burstEventId !== null
            && activityCapture.burstEventId !== undefined
          )
        ),
      );
      this.updateCaptureDescriptor(activityCapture, label, freqHz, shouldUpdatePendingSegment);
      this.activeStream.retuneDescriptorRollback = null;
      this.activeStream.pendingRetuneDescriptor = null;
      return true;
    }

    const { hackrf } = this.activeStream;
    if (!hackrf.stdin?.writable) return false;
    this.activeStream.retuneDescriptorRollback = previousDescriptor;
    this.activeStream.pendingRetuneDescriptor = this.buildCaptureDescriptor(activityCapture, label, freqHz);
    hackrf.stdin.write(`FREQ ${freqHz}\n`);

    if (this.activeStream.retuneTimer) {
      clearTimeout(this.activeStream.retuneTimer);
      this.activeStream.retuneTimer = null;
    }

    this.activeStream.session.phase = "retuning";
    this.activeStream.session.phaseSince = new Date().toISOString();
    this.activeStream.session.pendingFreqHz = freqHz;
    this.activeStream.session.pendingLabel = label;
    this.activeStream.telemetry = null;
    this.activeStream.session.telemetry = null;

    const sessionId = this.activeStream.session.id;
    this.activeStream.retuneTimer = setTimeout(() => {
      this.completeRetuneSuccess(sessionId, freqHz, label);
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
    if (!cachedFfmpegAvailable()) {
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
      spectrum: null,
      hackrf,
      ffmpeg,
      retuneTimer: null,
      retuneDescriptorRollback: null,
      pendingRetuneDescriptor: null,
      captureContext,
    };
    this.activeStream = activeStream;

    const finalize = () => {
      if (this.activeStream?.session.id !== sessionId) return;
      if (activeStream.retuneTimer) {
        clearTimeout(activeStream.retuneTimer);
        activeStream.retuneTimer = null;
      }
      this.flushPendingCapture(sessionId);
      hackrf.stdout?.unpipe(ffmpeg.stdin);
      try { ffmpeg.stdin?.end(); } catch { /* already gone */ }
      this.killProcess(hackrf);
      this.killProcess(ffmpeg);
      this.activeStream = null;
      hackrfDeviceService.release("audio");
      invalidateHackrfIdentityCache();
      // Mark the hackrf_info cache as stale so it re-probes on the next poll
      // cycle (after the 5 s TTL).  We deliberately do NOT null it out here
      // because that would trigger an immediate spawnSync on the very next
      // hardware poll, blocking the event loop while the USB device recovers
      // from the just-ended stream.
      if (_hackrfInfoCache) {
        _hackrfInfoCache.at = 0;
      }
    };

    const requestStop = () => {
      if (this.activeStream?.session.id !== sessionId) {
        return;
      }

      hackrf.stdout?.unpipe(ffmpeg.stdin);
      try { ffmpeg.stdin?.end(); } catch { /* already gone */ }
      this.killProcess(ffmpeg);
      this.killProcess(hackrf);
    };

    signal.addEventListener("abort", requestStop, { once: true });
    hackrf.once("close", finalize);
    ffmpeg.once("close", requestStop);

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

  getSpectrumFeed(): SpectrumFeedSnapshot {
    if (this.activeStream) {
      return {
        frame: this.activeStream.spectrum,
        message: this.activeStream.spectrum
          ? "Live RF spectrum from the current HackRF audio stream."
          : "The stream is running. Waiting for the first spectrum frame.",
        owner: "audio",
        state: this.activeStream.spectrum ? "ready" : "waiting",
        stream: {
          demodMode: this.activeStream.session.demodMode,
          freqHz: this.activeStream.session.freqHz,
          label: this.activeStream.session.label,
          phase: this.activeStream.session.phase,
        },
      };
    }

    const owner = hackrfDeviceService.getOwner();
    if (owner?.id === "ais") {
      const runtime = aisRuntime.getStatus();
      const frame = aisRuntime.getSpectrumFrame();
      const state = frame ? "ready" : runtime.state === "running" || runtime.state === "starting" ? "waiting" : "blocked";

      return {
        frame,
        message: frame
          ? "Live RF spectrum from the current AIS decoder band."
          : runtime.state === "starting"
            ? "AIS decoder is starting. Waiting for the first spectrum frame."
            : "AIS decoder is running. Waiting for the first spectrum frame.",
        owner: "ais",
        state,
        stream: {
          demodMode: null,
          freqHz: frame?.centerFreqHz ?? runtime.centerFreqHz,
          label: "AIS live decoder",
          phase: runtime.state === "starting" ? "starting" : "running",
        },
      };
    }

    if (owner?.id === "adsb") {
      return {
        frame: null,
        message: `${owner.label} is using the HackRF. Stop it to inspect the shared spectrum dock.`,
        owner: "adsb",
        state: "blocked",
        stream: null,
      };
    }

    return {
      frame: null,
      message: "Start an FM, PMR, AIRBAND, MARITIME, or AIS stream to populate the live spectrum dock.",
      owner: owner?.id ?? null,
      state: "idle",
      stream: null,
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

    const device = cachedHackrfIdentity();

    return {
      capturePrefix: capturePrefixForSession(request.activityCapture.module, sessionId),
      descriptor: {
        module: request.activityCapture.module,
        mode: request.activityCapture.mode,
        activityEventId: request.activityCapture.activityEventId ?? null,
        burstEventId: request.activityCapture.burstEventId ?? null,
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
          const telemetry = {
            rms: Number.parseFloat(match[1]),
            peak: Number.parseFloat(match[2]),
            rf: Number.parseFloat(match[3]),
            updatedAt: new Date().toISOString(),
          };
          this.activeStream.telemetry = telemetry;
          this.noteCaptureTelemetry(sessionId, telemetry);
          continue;
        }

        const spectrum = parseSpectrumFrameLine(line);
        if (spectrum && this.activeStream?.session.id === sessionId) {
          this.activeStream.spectrum = spectrum;
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
          continue;
        }

        const retuned = RETUNED_RE.exec(line);
        if (retuned && this.activeStream?.session.id === sessionId) {
          const targetFreqHz = Math.round(Number.parseFloat(retuned[1]) * 1_000_000);
          if (this.activeStream.session.pendingFreqHz !== targetFreqHz) {
            continue;
          }
          const pendingLabel = this.activeStream.session.pendingLabel ?? this.activeStream.session.label;
          this.completeRetuneSuccess(sessionId, targetFreqHz, pendingLabel);
          continue;
        }

        const retuneFailed = RETUNE_FAILED_RE.exec(line);
        if (retuneFailed && this.activeStream?.session.id === sessionId) {
          const targetFreqHz = Math.round(Number.parseFloat(retuneFailed[1]) * 1_000_000);
          if (this.activeStream.session.pendingFreqHz !== targetFreqHz) {
            continue;
          }
          this.completeRetuneFailure(sessionId);
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
    const pending = context.pendingSegment ?? createPendingSegment(context.descriptor);

    if (kind === "audio") {
      pending.audioPath = absolutePath;
    } else {
      pending.iqPath = absolutePath;
    }

    const telemetry = this.activeStream.telemetry;
    if (telemetry) {
      pending.rmsSum += telemetry.rms;
      pending.rmsCount += 1;
      pending.rmsPeak = Math.max(pending.rmsPeak ?? 0, telemetry.rms);
      pending.peakPeak = Math.max(pending.peakPeak ?? 0, telemetry.peak);
      pending.rfPeak = Math.max(pending.rfPeak ?? 0, telemetry.rf);
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
    const pending = context.pendingSegment ?? createPendingSegment(context.descriptor);

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
      try {
        this.persistPendingCapture(sessionId);
      } catch (err) {
        console.error("[hackrf] Failed to persist captured activity:", err);
      }
    }, CAPTURE_FINALIZE_SETTLE_MS);

    context.pendingSegment = pending;
  }

  private noteCaptureTelemetry(
    sessionId: string,
    telemetry: SignalLevelTelemetry,
  ): void {
    if (this.activeStream?.session.id !== sessionId || !this.activeStream.captureContext?.pendingSegment) {
      return;
    }

    const pending = this.activeStream.captureContext.pendingSegment;
    pending.rmsSum += telemetry.rms;
    pending.rmsCount += 1;
    pending.rmsPeak = Math.max(pending.rmsPeak ?? 0, telemetry.rms);
    pending.peakPeak = Math.max(pending.peakPeak ?? 0, telemetry.peak);
    pending.rfPeak = Math.max(pending.rfPeak ?? 0, telemetry.rf);
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
      activityEventId: pending.descriptor.activityEventId,
      burstEventId: pending.descriptor.burstEventId,
      label: pending.descriptor.label,
      freqHz: pending.descriptor.freqHz,
      demodMode: pending.descriptor.demodMode,
      bandId: pending.descriptor.bandId,
      channelId: pending.descriptor.channelId,
      channelNumber: pending.descriptor.channelNumber,
      startedAtMs: pending.startedAtMs,
      endedAtMs: Date.now(),
      rmsAvg: pending.rmsCount > 0 ? pending.rmsSum / pending.rmsCount : null,
      rmsPeak: pending.rmsPeak,
      rfPeak: pending.rfPeak,
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
        streamId: sessionId,
        burstEventId: pending.descriptor.burstEventId,
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
        segmentMetrics: {
          rmsAvg: pending.rmsCount > 0 ? pending.rmsSum / pending.rmsCount : null,
          rmsPeak: pending.rmsPeak,
          audioPeak: pending.peakPeak,
          rfPeak: pending.rfPeak,
          telemetrySamples: pending.rmsCount,
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
    const sessionId = this.activeStream.session.id;

    if (retuneTimer) {
      clearTimeout(retuneTimer);
    }

    // Register the wait listener before sending SIGTERM so we cannot miss the close event
    const released =
      hackrf.exitCode !== null || hackrf.killed
        ? Promise.resolve().then(() => {
          if (this.activeStream?.session.id === sessionId) {
            this.flushPendingCapture(sessionId);
            this.activeStream = null;
            hackrfDeviceService.release("audio");
            invalidateHackrfIdentityCache();
            if (_hackrfInfoCache) {
              _hackrfInfoCache.at = 0;
            }
          }
        })
        : new Promise<void>(resolve => hackrf.once("close", resolve));

    if (captureContext?.pendingSegment?.finalizeTimer) {
      clearTimeout(captureContext.pendingSegment.finalizeTimer);
      captureContext.pendingSegment.finalizeTimer = null;
    }
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
