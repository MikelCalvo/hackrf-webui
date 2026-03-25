import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";

import type {
  AudioDemodMode,
  HardwareStatus,
  SignalLevelTelemetry,
  StreamRequest,
  StreamSessionSnapshot,
} from "@/lib/types";
import { TELEMETRY_REPORT_INTERVAL_MS } from "@/lib/signal-activity";
import { adsbRuntime } from "@/server/adsb-runtime";
import { hackrfDeviceService } from "@/server/hackrf-device";
import { aisRuntime } from "@/server/ais-runtime";

const LEVEL_RE = /LEVEL rms=([0-9.]+) peak=([0-9.]+) rf=([0-9.]+)/;
const RETUNE_SETTLE_MS = 450;

type ActiveStream = {
  session: StreamSessionSnapshot;
  telemetry: SignalLevelTelemetry | null;
  hackrf: ReturnType<typeof spawn>;
  ffmpeg: ReturnType<typeof spawn>;
  retuneTimer: ReturnType<typeof setTimeout> | null;
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
  retune(freqHz: number, label: string, mode?: AudioDemodMode): boolean {
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

    const activeStream: ActiveStream = { session, telemetry: null, hackrf, ffmpeg, retuneTimer: null };
    this.activeStream = activeStream;

    const cleanup = () => {
      if (this.activeStream?.session.id !== sessionId) return;
      if (activeStream.retuneTimer) {
        clearTimeout(activeStream.retuneTimer);
        activeStream.retuneTimer = null;
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

  private attachTelemetry(stderr: NodeJS.ReadableStream, sessionId: string): void {
    let buffer = "";
    stderr.setEncoding("utf8");
    stderr.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        const match = LEVEL_RE.exec(line);
        if (!match || this.activeStream?.session.id !== sessionId) {
          continue;
        }

        this.activeStream.telemetry = {
          rms: Number.parseFloat(match[1]),
          peak: Number.parseFloat(match[2]),
          rf: Number.parseFloat(match[3]),
          updatedAt: new Date().toISOString(),
        };
      }
    });
  }

  private stopAndWait(): Promise<void> {
    if (!this.activeStream) return Promise.resolve();

    const { hackrf, ffmpeg, retuneTimer } = this.activeStream;
    this.activeStream = null;
    hackrfDeviceService.release("audio");

    if (retuneTimer) {
      clearTimeout(retuneTimer);
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
