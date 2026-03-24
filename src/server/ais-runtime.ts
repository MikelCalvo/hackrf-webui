import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type {
  AisBounds,
  AisChannelStatus,
  AisFeedSnapshot,
  AisPoint,
  AisRuntimeStatus,
  AisTilePackSummary,
  AisVesselContact,
} from "@/lib/types";
import { parseAisFrameLine, type DecodedAisMessage } from "@/server/ais-protocol";

type VesselAccumulator = {
  mmsi: string;
  name: string;
  callsign: string;
  imo: string;
  shipType: string;
  destination: string;
  latitude: number | null;
  longitude: number | null;
  speedKnots: number | null;
  courseDeg: number | null;
  navStatus: string;
  lastSeenAt: string | null;
  lastSeenMs: number;
  lastPositionAt: string | null;
  lastPositionMs: number;
  lastStaticAt: string | null;
  lastStaticMs: number;
  messageType: string;
  sourceLabel: string;
};

type ChannelInternalState = AisChannelStatus;

type LocalTilePackManifest = {
  kind?: "raster" | "pmtiles";
  name?: string;
  tileUrlTemplate?: string;
  pmtilesUrl?: string;
  flavor?: "light" | "dark" | "white" | "grayscale" | "black";
  lang?: string;
  attribution?: string;
  bounds?: AisBounds | null;
  minZoom?: number;
  maxZoom?: number;
  installedAt?: string;
};

const DEFAULT_TILE_URL_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_TILE_ATTRIBUTION = "\u00a9 OpenStreetMap contributors";
const TILE_PACK_MANIFEST_PATH = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "public",
  "tiles",
  "osm",
  "manifest.json",
);

const DEFAULT_CENTER_FREQ_HZ = 162_000_000;
const DEFAULT_SAMPLE_RATE = 1_536_000;
const DEFAULT_LNA_GAIN = 24;
const DEFAULT_VGA_GAIN = 20;

function normalizePmtilesFlavor(
  value: string | undefined,
): "light" | "dark" | "white" | "grayscale" | "black" {
  const trimmed = value?.trim();

  switch (trimmed) {
    case "light":
    case "white":
    case "grayscale":
    case "black":
      return trimmed;
    default:
      return "dark";
  }
}

function parseEnvInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function aisBinaryPath(): string {
  return (
    process.env.HACKRF_WEBUI_AIS_BIN?.trim()
    || path.join(/*turbopackIgnore: true*/ process.cwd(), "bin", "hackrf_ais_stream")
  );
}

function createChannelState(): ChannelInternalState[] {
  return [
    {
      id: "ais-a",
      label: "AIS A",
      freqHz: 161_975_000,
      frameCount: 0,
      messageCount: 0,
      lastSeenAt: null,
      lastMessageType: null,
      lastPhase: null,
    },
    {
      id: "ais-b",
      label: "AIS B",
      freqHz: 162_025_000,
      frameCount: 0,
      messageCount: 0,
      lastSeenAt: null,
      lastMessageType: null,
      lastPhase: null,
    },
  ];
}

function createAccumulator(mmsi: string): VesselAccumulator {
  return {
    mmsi,
    name: "",
    callsign: "",
    imo: "",
    shipType: "",
    destination: "",
    latitude: null,
    longitude: null,
    speedKnots: null,
    courseDeg: null,
    navStatus: "",
    lastSeenAt: null,
    lastSeenMs: -1,
    lastPositionAt: null,
    lastPositionMs: -1,
    lastStaticAt: null,
    lastStaticMs: -1,
    messageType: "",
    sourceLabel: "",
  };
}

function buildTilePackSummary(warnings: string[]): AisTilePackSummary {
  if (!existsSync(TILE_PACK_MANIFEST_PATH)) {
    warnings.push(
      "Offline AIS tiles are not installed. The map will use live OpenStreetMap tiles until a local pack is imported.",
    );

    return {
      available: false,
      mode: "remote-live",
      kind: "raster",
      name: "OpenStreetMap Live",
      tileUrlTemplate: DEFAULT_TILE_URL_TEMPLATE,
      pmtilesUrl: null,
      flavor: null,
      lang: null,
      attribution: DEFAULT_TILE_ATTRIBUTION,
      bounds: null,
      minZoom: 3,
      maxZoom: 19,
      installedAt: null,
      manifestPath: null,
    };
  }

  try {
    const manifest = JSON.parse(readFileSync(TILE_PACK_MANIFEST_PATH, "utf8")) as LocalTilePackManifest;
    const kind = manifest.kind === "pmtiles" ? "pmtiles" : "raster";
    return {
      available: true,
      mode: "local-pack",
      kind,
      name:
        manifest.name?.trim()
        || (kind === "pmtiles" ? "Protomaps Dark Offline World" : "AIS Offline Tile Pack"),
      tileUrlTemplate:
        kind === "raster"
          ? manifest.tileUrlTemplate?.trim() || "/tiles/osm/{z}/{x}/{y}.png"
          : null,
      pmtilesUrl:
        kind === "pmtiles"
          ? manifest.pmtilesUrl?.trim() || "/tiles/osm/world.pmtiles"
          : null,
      flavor: kind === "pmtiles" ? normalizePmtilesFlavor(manifest.flavor) : null,
      lang: kind === "pmtiles" ? manifest.lang?.trim() || "en" : null,
      attribution: manifest.attribution?.trim() || DEFAULT_TILE_ATTRIBUTION,
      bounds: manifest.bounds ?? null,
      minZoom: Number.isFinite(manifest.minZoom) ? Math.max(0, manifest.minZoom!) : 0,
      maxZoom: Number.isFinite(manifest.maxZoom) ? Math.max(0, manifest.maxZoom!) : 12,
      installedAt: manifest.installedAt?.trim() || null,
      manifestPath: TILE_PACK_MANIFEST_PATH,
    };
  } catch {
    warnings.push("The offline AIS tile manifest is present but could not be parsed.");

    return {
      available: false,
      mode: "remote-live",
      kind: "raster",
      name: "OpenStreetMap Live",
      tileUrlTemplate: DEFAULT_TILE_URL_TEMPLATE,
      pmtilesUrl: null,
      flavor: null,
      lang: null,
      attribution: DEFAULT_TILE_ATTRIBUTION,
      bounds: null,
      minZoom: 3,
      maxZoom: 19,
      installedAt: null,
      manifestPath: TILE_PACK_MANIFEST_PATH,
    };
  }
}

function computeBounds(vessels: AisVesselContact[]): AisBounds | null {
  if (vessels.length === 0) {
    return null;
  }

  let west = vessels[0].longitude;
  let east = vessels[0].longitude;
  let south = vessels[0].latitude;
  let north = vessels[0].latitude;

  for (const vessel of vessels) {
    west = Math.min(west, vessel.longitude);
    east = Math.max(east, vessel.longitude);
    south = Math.min(south, vessel.latitude);
    north = Math.max(north, vessel.latitude);
  }

  return { west, south, east, north };
}

function boundsCenter(bounds: AisBounds | null): AisPoint | null {
  if (!bounds) {
    return null;
  }

  return {
    latitude: (bounds.south + bounds.north) / 2,
    longitude: (bounds.west + bounds.east) / 2,
  };
}

class AisRuntimeService {
  private process: ReturnType<typeof spawn> | null = null;

  private expectedExit = false;

  private stdoutBuffer = "";

  private stderrBuffer = "";

  private stderrLines: string[] = [];

  private vessels = new Map<string, VesselAccumulator>();

  private channels = createChannelState();

  private runtime: AisRuntimeStatus = this.buildBaseStatus("stopped", "AIS decoder is stopped.");

  private buildBaseStatus(
    state: AisRuntimeStatus["state"],
    message: string,
  ): AisRuntimeStatus {
    return {
      state,
      message,
      binaryAvailable: existsSync(aisBinaryPath()),
      binaryPath: aisBinaryPath(),
      startedAt: null,
      lastFrameAt: null,
      centerFreqHz: parseEnvInteger("AIS_CENTER_FREQ_HZ", DEFAULT_CENTER_FREQ_HZ),
      sampleRate: parseEnvInteger("AIS_SAMPLE_RATE", DEFAULT_SAMPLE_RATE),
    };
  }

  async start(): Promise<AisRuntimeStatus> {
    if (this.process && this.runtime.state === "running") {
      return this.getStatus();
    }

    if (this.process && this.runtime.state === "starting") {
      return this.getStatus();
    }

    const binaryPath = aisBinaryPath();
    if (!existsSync(binaryPath)) {
      this.runtime = this.buildBaseStatus("error", "The AIS native binary is missing. Run npm run build.");
      throw new Error(this.runtime.message);
    }

    this.expectedExit = false;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.stderrLines = [];
    this.vessels.clear();
    this.channels = createChannelState();
    this.runtime = {
      ...this.buildBaseStatus("starting", "Starting AIS decoder..."),
      startedAt: new Date().toISOString(),
    };

    const proc = spawn(
      binaryPath,
      [
        "-f", String(this.runtime.centerFreqHz),
        "-r", String(this.runtime.sampleRate),
        "-l", String(parseEnvInteger("AIS_LNA_GAIN", DEFAULT_LNA_GAIN)),
        "-g", String(parseEnvInteger("AIS_VGA_GAIN", DEFAULT_VGA_GAIN)),
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    if (!proc.stdout || !proc.stderr) {
      proc.kill("SIGTERM");
      this.runtime = this.buildBaseStatus("error", "Could not initialize the AIS runtime process.");
      throw new Error(this.runtime.message);
    }

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => this.handleStdout(chunk));

    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => this.handleStderr(chunk));

    proc.once("error", (error) => {
      this.process = null;
      this.runtime = this.buildBaseStatus("error", error.message || "Could not start the AIS decoder.");
    });

    proc.once("close", (code, signal) => {
      this.process = null;
      if (this.expectedExit) {
        this.runtime = this.buildBaseStatus("stopped", "AIS decoder is stopped.");
        return;
      }

      const tail = this.stderrLines.at(-1);
      this.runtime = {
        ...this.buildBaseStatus("error", tail || `AIS decoder stopped unexpectedly (code ${code ?? -1}, signal ${signal ?? "none"}).`),
        startedAt: this.runtime.startedAt,
        lastFrameAt: this.runtime.lastFrameAt,
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
          message: "AIS decoder running on HackRF channels A and B.",
        };
        resolve();
      }, 400);

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
      this.runtime = this.buildBaseStatus("stopped", "AIS decoder is stopped.");
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

  getStatus(): AisRuntimeStatus {
    return {
      ...this.runtime,
      binaryAvailable: existsSync(aisBinaryPath()),
      binaryPath: aisBinaryPath(),
    };
  }

  getSnapshot(): AisFeedSnapshot {
    const warnings: string[] = [];
    const tilePack = buildTilePackSummary(warnings);

    if (this.runtime.state === "error") {
      warnings.push(this.runtime.message);
    } else if (this.runtime.state === "stopped") {
      warnings.push("AIS decoder is stopped. Open the AIS panel to start live reception.");
    }

    const vessels = [...this.vessels.values()]
      .filter(
        (vessel): vessel is VesselAccumulator & {
          latitude: number;
          longitude: number;
          lastSeenAt: string;
          lastPositionAt: string;
        } =>
          vessel.latitude !== null
          && vessel.longitude !== null
          && Boolean(vessel.lastSeenAt)
          && Boolean(vessel.lastPositionAt),
      )
      .map<AisVesselContact>((vessel) => ({
        mmsi: vessel.mmsi,
        name: vessel.name,
        callsign: vessel.callsign,
        imo: vessel.imo,
        shipType: vessel.shipType,
        destination: vessel.destination,
        latitude: vessel.latitude,
        longitude: vessel.longitude,
        speedKnots: vessel.speedKnots,
        courseDeg: vessel.courseDeg,
        navStatus: vessel.navStatus,
        lastSeenAt: vessel.lastSeenAt,
        lastPositionAt: vessel.lastPositionAt,
        lastStaticAt: vessel.lastStaticAt,
        messageType: vessel.messageType,
        sourceLabel: vessel.sourceLabel,
        isMoving: (vessel.speedKnots ?? 0) > 0.5,
      }))
      .sort((left, right) => {
        const leftMs = Date.parse(left.lastSeenAt);
        const rightMs = Date.parse(right.lastSeenAt);
        return rightMs - leftMs || left.mmsi.localeCompare(right.mmsi);
      });

    const bounds = computeBounds(vessels);
    const latestPositionAt =
      vessels.reduce<string | null>((latest, vessel) => {
        if (!latest) {
          return vessel.lastPositionAt;
        }

        return Date.parse(vessel.lastPositionAt) > Date.parse(latest)
          ? vessel.lastPositionAt
          : latest;
      }, null);

    return {
      generatedAt: new Date().toISOString(),
      vesselCount: vessels.length,
      movingCount: vessels.filter((vessel) => vessel.isMoving).length,
      latestPositionAt,
      center: boundsCenter(bounds),
      bounds,
      vessels,
      channels: this.channels.map((channel) => ({ ...channel })),
      warnings,
      tilePack,
      runtime: this.getStatus(),
    };
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() || "";

    for (const line of lines) {
      const decoded = parseAisFrameLine(line);
      if (!decoded) {
        continue;
      }

      this.runtime.lastFrameAt = decoded.receivedAt;
      this.mergeMessage(decoded);
    }
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

  private mergeMessage(message: DecodedAisMessage): void {
    const channelId = message.channel === "A" ? "ais-a" : message.channel === "B" ? "ais-b" : "";
    const channel = this.channels.find((entry) => entry.id === channelId);
    const seenAtMs = Date.parse(message.receivedAt);
    const vessel = this.vessels.get(message.mmsi) ?? createAccumulator(message.mmsi);

    if (channel) {
      channel.frameCount += 1;
      channel.messageCount += 1;
      channel.lastSeenAt = message.receivedAt;
      channel.lastMessageType = message.messageTypeLabel;
      channel.lastPhase = message.phase;
    }

    if (seenAtMs >= vessel.lastSeenMs) {
      vessel.lastSeenAt = message.receivedAt;
      vessel.lastSeenMs = seenAtMs;
      vessel.messageType = message.messageTypeLabel;
      vessel.sourceLabel = channel?.label ?? `AIS ${message.channel}`;
    }

    if (typeof message.latitude === "number" && typeof message.longitude === "number") {
      if (seenAtMs >= vessel.lastPositionMs) {
        vessel.latitude = message.latitude;
        vessel.longitude = message.longitude;
        vessel.speedKnots = message.speedKnots ?? null;
        vessel.courseDeg = message.courseDeg ?? message.headingDeg ?? null;
        vessel.navStatus = message.navStatus ?? vessel.navStatus;
        vessel.lastPositionAt = message.receivedAt;
        vessel.lastPositionMs = seenAtMs;
      }
    }

    if (
      message.name
      || message.callsign
      || message.destination
      || message.imo
      || message.shipType
    ) {
      if (seenAtMs >= vessel.lastStaticMs) {
        vessel.name = message.name || vessel.name;
        vessel.callsign = message.callsign || vessel.callsign;
        vessel.destination = message.destination || vessel.destination;
        vessel.imo = message.imo || vessel.imo;
        vessel.shipType = message.shipType || vessel.shipType;
        vessel.lastStaticAt = message.receivedAt;
        vessel.lastStaticMs = seenAtMs;
      }
    }

    this.vessels.set(message.mmsi, vessel);
  }
}

declare global {
  var __hackrfWebUiAisRuntime: AisRuntimeService | undefined;
}

export const aisRuntime =
  global.__hackrfWebUiAisRuntime ?? new AisRuntimeService();

if (process.env.NODE_ENV !== "production") {
  global.__hackrfWebUiAisRuntime = aisRuntime;
}
