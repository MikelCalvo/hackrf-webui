import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import type {
  AdsbAircraftContact,
  AdsbFeedSnapshot,
  AdsbReceiverInfo,
  AdsbRuntimeStatus,
  GeoBounds,
  GeoPoint,
} from "@/lib/types";
import {
  parseDump1090Aircraft,
  parseDump1090ReceiverInfo,
  parseDump1090Stats,
} from "@/server/adsb-protocol";
import { hackrfDeviceService } from "@/server/hackrf-device";
import { pickHackrfRuntimeErrorMessage } from "@/server/hackrf-runtime-errors";
import { buildOfflineMapSummary } from "@/server/maps";

const DEFAULT_CENTER_FREQ_HZ = 1_090_000_000;
const DEFAULT_SAMPLE_RATE = 2_400_000;
const DEFAULT_LNA_GAIN = 32;
const DEFAULT_VGA_GAIN = 50;
const DEFAULT_PPM = 0;
const ADSB_JSON_DIR = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  ".cache",
  "adsb-runtime",
  "json",
);

function parseEnvInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function parseEnvFloat(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return null;
  }

  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function adsbBinaryPath(): string {
  return (
    process.env.HACKRF_WEBUI_ADSB_BIN?.trim()
    || path.join(/*turbopackIgnore: true*/ process.cwd(), "bin", "dump1090-fa")
  );
}

function aircraftBounds(aircraft: AdsbAircraftContact[]): GeoBounds | null {
  const positioned = aircraft.filter(
    (entry): entry is AdsbAircraftContact & { latitude: number; longitude: number } =>
      entry.latitude !== null && entry.longitude !== null,
  );
  if (positioned.length === 0) {
    return null;
  }

  let west = positioned[0].longitude;
  let east = positioned[0].longitude;
  let south = positioned[0].latitude;
  let north = positioned[0].latitude;

  for (const entry of positioned) {
    west = Math.min(west, entry.longitude);
    east = Math.max(east, entry.longitude);
    south = Math.min(south, entry.latitude);
    north = Math.max(north, entry.latitude);
  }

  return { west, south, east, north };
}

function boundsCenter(bounds: GeoBounds | null): GeoPoint | null {
  if (!bounds) {
    return null;
  }

  return {
    latitude: (bounds.south + bounds.north) / 2,
    longitude: (bounds.west + bounds.east) / 2,
  };
}

function safeReadFile(filePath: string): string | null {
  try {
    return existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
  } catch {
    return null;
  }
}

class AdsbRuntimeService {
  private process: ReturnType<typeof spawn> | null = null;

  private expectedExit = false;

  private stderrBuffer = "";

  private stderrLines: string[] = [];

  private runtime: AdsbRuntimeStatus = this.buildBaseStatus("stopped", "ADS-B decoder is stopped.");

  private buildBaseStatus(
    state: AdsbRuntimeStatus["state"],
    message: string,
  ): AdsbRuntimeStatus {
    return {
      state,
      message,
      binaryAvailable: existsSync(adsbBinaryPath()),
      binaryPath: adsbBinaryPath(),
      startedAt: null,
      lastJsonAt: null,
      centerFreqHz: DEFAULT_CENTER_FREQ_HZ,
      sampleRate: parseEnvInteger("ADSB_SAMPLE_RATE", DEFAULT_SAMPLE_RATE),
      jsonDir: ADSB_JSON_DIR,
      receiverLatitude: parseEnvFloat("ADSB_RECEIVER_LAT"),
      receiverLongitude: parseEnvFloat("ADSB_RECEIVER_LON"),
    };
  }

  async start(): Promise<AdsbRuntimeStatus> {
    if (this.process && (this.runtime.state === "running" || this.runtime.state === "starting")) {
      return this.getStatus();
    }

    const binaryPath = adsbBinaryPath();
    if (!existsSync(binaryPath)) {
      this.runtime = this.buildBaseStatus("error", "The ADS-B decoder binary is missing. Run ./start.sh.");
      throw new Error(this.runtime.message);
    }

    hackrfDeviceService.claim("adsb", "the ADS-B decoder");

    rmSync(ADSB_JSON_DIR, { recursive: true, force: true });
    mkdirSync(ADSB_JSON_DIR, { recursive: true });

    this.expectedExit = false;
    this.stderrBuffer = "";
    this.stderrLines = [];
    this.runtime = {
      ...this.buildBaseStatus("starting", "Starting ADS-B decoder..."),
      startedAt: new Date().toISOString(),
    };

    const args = [
      "--device-type", "hackrf",
      "--write-json", ADSB_JSON_DIR,
      "--write-json-every", "1",
      "--json-stats-every", "60",
      "--quiet",
      "--samplerate", String(this.runtime.sampleRate),
      "--lna-gain", String(parseEnvInteger("ADSB_LNA_GAIN", DEFAULT_LNA_GAIN)),
      "--vga-gain", String(parseEnvInteger("ADSB_VGA_GAIN", DEFAULT_VGA_GAIN)),
    ];

    const ppm = parseEnvInteger("ADSB_PPM", DEFAULT_PPM);
    if (ppm !== 0) {
      args.push("--ppm", String(ppm));
    }
    if (process.env.ADSB_ENABLE_AMP === "1") {
      args.push("--enable-amp");
    }
    if (process.env.ADSB_ENABLE_ANTENNA_POWER === "1") {
      args.push("--enable-antenna-power");
    }
    if (
      this.runtime.receiverLatitude !== null
      && this.runtime.receiverLongitude !== null
    ) {
      args.push("--lat", String(this.runtime.receiverLatitude));
      args.push("--lon", String(this.runtime.receiverLongitude));
    }

    const proc = spawn(binaryPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    if (!proc.stderr) {
      proc.kill("SIGTERM");
      hackrfDeviceService.release("adsb");
      this.runtime = this.buildBaseStatus("error", "Could not initialize the ADS-B runtime process.");
      throw new Error(this.runtime.message);
    }

    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => this.handleStderr(chunk));

    proc.once("error", (error) => {
      this.process = null;
      hackrfDeviceService.release("adsb");
      this.runtime = this.buildBaseStatus("error", error.message || "Could not start the ADS-B decoder.");
    });

    proc.once("close", (code, signal) => {
      this.process = null;
      hackrfDeviceService.release("adsb");
      if (this.expectedExit) {
        this.runtime = this.buildBaseStatus("stopped", "ADS-B decoder is stopped.");
        return;
      }

      const fallbackMessage = `ADS-B decoder stopped unexpectedly (code ${code ?? -1}, signal ${signal ?? "none"}).`;
      this.runtime = {
        ...this.buildBaseStatus(
          "error",
          pickHackrfRuntimeErrorMessage(this.stderrLines, fallbackMessage),
        ),
        startedAt: this.runtime.startedAt,
        lastJsonAt: this.runtime.lastJsonAt,
      };
    });

    this.process = proc;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.process || this.process.exitCode !== null) {
          reject(new Error(this.runtime.message));
          return;
        }

        this.runtime = {
          ...this.runtime,
          state: "running",
          message: "ADS-B decoder running on the HackRF.",
        };
        resolve();
      }, 500);

      proc.once("close", () => {
        clearTimeout(timer);
        reject(new Error(this.runtime.message));
      });
      proc.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    return this.getStatus();
  }

  async stop(): Promise<void> {
    if (!this.process) {
      hackrfDeviceService.release("adsb");
      this.runtime = this.buildBaseStatus("stopped", "ADS-B decoder is stopped.");
      return;
    }

    const proc = this.process;
    this.expectedExit = true;

    await new Promise<void>((resolve) => {
      const finalize = () => resolve();
      proc.once("close", finalize);
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (proc.exitCode === null && !proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 250);
    });
  }

  getStatus(): AdsbRuntimeStatus {
    return {
      ...this.runtime,
      binaryAvailable: existsSync(adsbBinaryPath()),
      binaryPath: adsbBinaryPath(),
    };
  }

  getSnapshot(): AdsbFeedSnapshot {
    const warnings: string[] = [];
    const maps = buildOfflineMapSummary(warnings);
    const receiver = this.readReceiverInfo();
    const stats = this.readStats();
    const aircraftData = this.readAircraft();
    const aircraft = aircraftData?.aircraft ?? [];
    const bounds = aircraftBounds(aircraft);
    const latestMessageAt = aircraft.reduce<string | null>((latest, entry) => {
      if (!latest) {
        return entry.seenAt;
      }

      return Date.parse(entry.seenAt) > Date.parse(latest) ? entry.seenAt : latest;
    }, null);

    if (
      receiver
      && receiver.latitude !== null
      && receiver.longitude !== null
    ) {
      this.runtime.receiverLatitude = receiver.latitude;
      this.runtime.receiverLongitude = receiver.longitude;
    }
    if (aircraftData?.generatedAt) {
      this.runtime.lastJsonAt = aircraftData.generatedAt;
    }

    if (this.runtime.state === "error") {
      warnings.push(this.runtime.message);
    } else if (this.runtime.state === "stopped") {
      warnings.push("ADS-B decoder is stopped. Open the ADS-B panel to start live reception.");
    }

    if ((this.runtime.state === "running" || this.runtime.state === "starting") && !aircraftData) {
      warnings.push("ADS-B JSON output is not ready yet.");
    }

    return {
      generatedAt: new Date().toISOString(),
      aircraftCount: aircraft.length,
      positionCount: aircraft.filter((entry) => entry.latitude !== null && entry.longitude !== null).length,
      airborneCount: aircraft.filter((entry) => !entry.onGround).length,
      latestMessageAt,
      center: boundsCenter(bounds),
      bounds,
      aircraft,
      warnings,
      maps,
      runtime: this.getStatus(),
      receiver,
      stats,
    };
  }

  private readReceiverInfo(): AdsbReceiverInfo | null {
    const content = safeReadFile(path.join(ADSB_JSON_DIR, "receiver.json"));
    return content ? parseDump1090ReceiverInfo(content) : null;
  }

  private readStats() {
    const content = safeReadFile(path.join(ADSB_JSON_DIR, "stats.json"));
    return content ? parseDump1090Stats(content) : null;
  }

  private readAircraft() {
    const content = safeReadFile(path.join(ADSB_JSON_DIR, "aircraft.json"));
    return content ? parseDump1090Aircraft(content) : null;
  }

  private handleStderr(chunk: string): void {
    this.stderrBuffer += chunk;
    const lines = this.stderrBuffer.split(/\r?\n/);
    this.stderrBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      this.stderrLines.push(trimmed);
      if (this.stderrLines.length > 12) {
        this.stderrLines.shift();
      }
    }
  }
}

declare global {
  var __hackrfWebUiAdsbRuntime: AdsbRuntimeService | undefined;
}

export const adsbRuntime =
  global.__hackrfWebUiAdsbRuntime ?? new AdsbRuntimeService();

if (process.env.NODE_ENV !== "production") {
  global.__hackrfWebUiAdsbRuntime = adsbRuntime;
}
