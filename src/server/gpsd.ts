import net from "node:net";

import type { GpsdFixState, GpsdSnapshot } from "@/lib/types";

const DEFAULT_GPSD_HOST = process.env.HACKRF_WEBUI_GPSD_HOST?.trim() || "127.0.0.1";
const DEFAULT_GPSD_PORT = Number.parseInt(process.env.HACKRF_WEBUI_GPSD_PORT ?? "2947", 10) || 2947;
const GPSD_TIMEOUT_MS = 2_500;

type GpsdTpv = {
  class?: string;
  mode?: number;
  lat?: number;
  lon?: number;
  alt?: number;
  speed?: number;
  track?: number;
  time?: string;
  device?: string;
};

type GpsdDevice = {
  path?: string;
  driver?: string;
  activated?: string;
  flags?: number;
};

type GpsdDevicesResponse = {
  class?: string;
  devices?: GpsdDevice[];
};

type GpsdDeviceResponse = GpsdDevice & {
  class?: string;
};

function classifyFixState(mode: number): GpsdFixState {
  if (mode >= 3) {
    return "3d";
  }

  if (mode >= 2) {
    return "2d";
  }

  return "no-fix";
}

function buildUnavailableSnapshot(message: string): GpsdSnapshot {
  return {
    available: false,
    host: DEFAULT_GPSD_HOST,
    port: DEFAULT_GPSD_PORT,
    activeDevices: 0,
    fixState: "unavailable",
    mode: 0,
    latitude: null,
    longitude: null,
    altitudeMeters: null,
    speedMps: null,
    trackDeg: null,
    time: null,
    device: null,
    message,
  };
}

function buildGpsdMessage(args: {
  activeDevices: number;
  device: string | null;
  fixState: GpsdFixState;
}): string {
  const { activeDevices, device, fixState } = args;

  if (activeDevices === 0) {
    return "GPSD is reachable, but no GPS receiver is active. Check the USB device, gpsd startup, and permissions.";
  }

  if (fixState === "no-fix") {
    return device
      ? `GPSD can see ${device}, but it does not have a position fix yet. Make sure the antenna has sky view and give it time to lock.`
      : "GPSD can see a receiver, but it does not have a position fix yet. Make sure the antenna has sky view and give it time to lock.";
  }

  return device
    ? `GPSD ${fixState.toUpperCase()} fix from ${device}.`
    : `GPSD ${fixState.toUpperCase()} fix available.`;
}

function pickBestTpv(entries: GpsdTpv[]): GpsdTpv | null {
  if (entries.length === 0) {
    return null;
  }

  const ranked = entries
    .slice()
    .sort((left, right) => {
      const leftScore =
        (typeof left.lat === "number" && typeof left.lon === "number" ? 100 : 0)
        + (typeof left.mode === "number" ? left.mode : 0);
      const rightScore =
        (typeof right.lat === "number" && typeof right.lon === "number" ? 100 : 0)
        + (typeof right.mode === "number" ? right.mode : 0);
      return rightScore - leftScore;
    });

  return ranked[0] ?? null;
}

function hasUsableFix(entry: GpsdTpv | null): boolean {
  if (!entry) {
    return false;
  }

  return (
    typeof entry.lat === "number"
    && typeof entry.lon === "number"
    && typeof entry.mode === "number"
    && classifyFixState(Math.max(0, Math.round(entry.mode))) !== "no-fix"
  );
}

function upsertDevice(devices: Map<string, GpsdDevice>, device: GpsdDevice): void {
  const path = typeof device.path === "string" && device.path.length > 0
    ? device.path
    : `__anonymous__:${devices.size}`;
  const current = devices.get(path) ?? {};
  devices.set(path, {
    ...current,
    ...device,
  });
}

async function requestGpsdState(): Promise<{
  devices: GpsdDevice[];
  tpvEntries: GpsdTpv[];
}> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: DEFAULT_GPSD_HOST,
      port: DEFAULT_GPSD_PORT,
    });
    let buffer = "";
    let settled = false;
    let sawPayload = false;
    const devices = new Map<string, GpsdDevice>();
    const tpvEntries: GpsdTpv[] = [];

    const timeout = setTimeout(() => {
      if (sawPayload || devices.size > 0 || tpvEntries.length > 0) {
        settleWithResult();
        return;
      }

      socket.destroy(new Error("Timed out waiting for GPSD."));
    }, GPSD_TIMEOUT_MS);

    function cleanup(): void {
      clearTimeout(timeout);
      socket.removeAllListeners();
    }

    function settleWithError(error: Error): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    }

    function settleWithResult(): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      socket.end();
      resolve({
        devices: [...devices.values()],
        tpvEntries,
      });
    }

    function maybeSettle(): void {
      if (settled) {
        return;
      }

      const bestTpv = pickBestTpv(tpvEntries);
      if (hasUsableFix(bestTpv)) {
        settleWithResult();
        return;
      }

      if (devices.size > 0 && tpvEntries.length > 0) {
        settleWithResult();
      }
    }

    function parseLine(line: string): void {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) {
        return;
      }

      try {
        const payload = JSON.parse(trimmed) as
          | GpsdDevicesResponse
          | GpsdDeviceResponse
          | GpsdTpv;
        if (payload.class === "DEVICES") {
          sawPayload = true;
          const devicesPayload = payload as GpsdDevicesResponse;
          if (Array.isArray(devicesPayload.devices)) {
            for (const device of devicesPayload.devices) {
              upsertDevice(devices, device);
            }
          }
          maybeSettle();
          return;
        }

        if (payload.class === "DEVICE") {
          sawPayload = true;
          upsertDevice(devices, payload as GpsdDeviceResponse);
          maybeSettle();
          return;
        }

        if (payload.class === "TPV") {
          sawPayload = true;
          tpvEntries.push(payload as GpsdTpv);
          maybeSettle();
        }
      } catch {
        // Ignore non-JSON or partial lines until the socket closes.
      }
    }

    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write("?WATCH={\"enable\":true,\"json\":true};\n?DEVICES;\n");
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        parseLine(line);
        newlineIndex = buffer.indexOf("\n");
      }
    });
    socket.once("error", (error) => {
      settleWithError(error instanceof Error ? error : new Error("GPSD connection failed."));
    });
    socket.once("close", () => {
      if (settled) {
        return;
      }

      if (buffer.trim()) {
        parseLine(buffer);
      }

      if (sawPayload || devices.size > 0 || tpvEntries.length > 0) {
        settleWithResult();
        return;
      }

      if (!settled) {
        settleWithError(new Error("GPSD closed the connection before returning any usable state."));
      }
    });
  });
}

export async function readGpsdSnapshot(): Promise<GpsdSnapshot> {
  try {
    const { devices, tpvEntries } = await requestGpsdState();
    const knownDevices = Array.isArray(devices) ? devices : [];
    const activeDevices = knownDevices.length > 0
      ? knownDevices.length
      : new Set(
        tpvEntries
          .map((entry) => (typeof entry.device === "string" ? entry.device.trim() : ""))
          .filter((device) => device.length > 0),
      ).size;
    const bestTpv = pickBestTpv(tpvEntries);
    const mode =
      typeof bestTpv?.mode === "number" && Number.isFinite(bestTpv.mode)
        ? Math.max(0, Math.round(bestTpv.mode))
        : 0;
    const fixState = classifyFixState(mode);
    const device = typeof bestTpv?.device === "string"
      ? bestTpv.device
      : typeof knownDevices[0]?.path === "string"
        ? knownDevices[0].path
        : null;

    const message = buildGpsdMessage({
      activeDevices,
      device,
      fixState,
    });

    return {
      available: true,
      host: DEFAULT_GPSD_HOST,
      port: DEFAULT_GPSD_PORT,
      activeDevices,
      fixState,
      mode,
      latitude: typeof bestTpv?.lat === "number" ? bestTpv.lat : null,
      longitude: typeof bestTpv?.lon === "number" ? bestTpv.lon : null,
      altitudeMeters: typeof bestTpv?.alt === "number" ? bestTpv.alt : null,
      speedMps: typeof bestTpv?.speed === "number" ? bestTpv.speed : null,
      trackDeg: typeof bestTpv?.track === "number" ? bestTpv.track : null,
      time: typeof bestTpv?.time === "string" ? bestTpv.time : null,
      device,
      message,
    };
  } catch (error) {
    return buildUnavailableSnapshot(
      error instanceof Error
        ? `Could not connect to GPSD at ${DEFAULT_GPSD_HOST}:${DEFAULT_GPSD_PORT}. ${error.message}`
        : `Could not connect to GPSD at ${DEFAULT_GPSD_HOST}:${DEFAULT_GPSD_PORT}.`,
    );
  }
}
