import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import packageJson from "../../package.json";
import type { AdsbRuntimeStatus, AisRuntimeStatus, HardwareStatus } from "@/lib/types";
import type { RuntimeDiagnostics } from "@/lib/runtime-diagnostics";
import { isHackrfSimulatorEnabled } from "@/server/hackrf-simulator";
import { isReplayModeEnabled } from "@/server/replay-feed";

type Env = Record<string, string | undefined>;

type PathProbe = {
  exists: boolean;
  writable: boolean;
};

type PathProbeMap = Record<string, PathProbe>;

type PackageInfo = {
  name: string;
  version: string;
};

type SupervisorSnapshot = {
  sessions: unknown[];
  scheduler: unknown;
  recentSessionEvents: unknown[];
  listeners: unknown;
  stats: {
    createdCount: number;
    stoppedCount: number;
    failedCreateCount: number;
    failedStopCount: number;
    liveSessionCount: number;
  };
};

export type RuntimeDiagnosticsServices = {
  hardware: HardwareStatus;
  aisRuntime: AisRuntimeStatus;
  adsbRuntime: AdsbRuntimeStatus;
  supervisor: SupervisorSnapshot;
};

type BuildRuntimeDiagnosticsOptions = {
  now?: Date;
  cwd?: string;
  env?: Env;
  packageInfo?: PackageInfo;
  services: RuntimeDiagnosticsServices;
  pathChecks?: PathProbeMap;
};

type PublicPathProbe = PathProbe & {
  path: string;
};


const ENV_KEYS = [
  "HACKRF_WEBUI_SIMULATOR",
  "HACKRF_WEBUI_REPLAY",
  "HACKRF_WEBUI_TOKEN",
  "NEXT_PUBLIC_HACKRF_WEBUI_TOKEN",
  "HACKRF_WEBUI_ALLOWED_ORIGINS",
  "HACKRF_WEBUI_NATIVE_BIN",
] as const;

const SECRET_KEY_RE = /(?:token|secret|password|passwd|credential|authorization|bearer|cookie|api[_-]?key|private[_-]?key)/i;
const SECRET_QUERY_RE = /([?&](?:apiToken|token|access_token|refresh_token|key|api_key|password|secret)=)([^&#]+)/gi;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeString(value: string): string {
  return value
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(SECRET_QUERY_RE, "$1[redacted]")
    .replace(/:\/\/([^:@/\s]+):([^@/\s]+)@/g, "://[redacted]@");
}

export function redactDiagnosticValue<T>(value: T, keyPath: string[] = []): T {
  const keyName = keyPath.at(-1) ?? "";
  if (typeof value === "string") {
    const sanitized = sanitizeString(value);
    const isStatusValue = value === "configured" || value === "enabled" || value === "disabled" || value === "unset";
    if (SECRET_KEY_RE.test(keyName) && value && !isStatusValue) {
      return (/^Bearer\s+/i.test(value) ? sanitized : "[redacted]") as T;
    }
    return sanitized as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactDiagnosticValue(entry, keyPath)) as T;
  }
  if (isObject(value)) {
    const entries = Object.entries(value).map(([key, entry]) => [
      key,
      redactDiagnosticValue(entry, [...keyPath, key]),
    ]);
    return Object.fromEntries(entries) as T;
  }
  return value;
}

function envState(env: Env, key: string): "configured" | "enabled" | "disabled" | "unset" {
  const value = env[key]?.trim();
  if (!value) {
    return "unset";
  }
  if (key === "HACKRF_WEBUI_SIMULATOR" || key === "HACKRF_WEBUI_REPLAY") {
    return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase()) ? "enabled" : "disabled";
  }
  return "configured";
}

function publicPath(filePath: string, cwd: string): string {
  if (/^[a-z]+:\/\//i.test(filePath)) {
    return filePath;
  }
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const relative = path.relative(cwd, absolute);
  if (!relative || relative === "") {
    return ".";
  }
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return `<external>/${path.basename(filePath)}`;
}

function probePath(absolutePath: string, injected?: PathProbe): PathProbe {
  if (injected) {
    return injected;
  }
  const exists = existsSync(absolutePath);
  let writable = false;
  if (exists) {
    try {
      accessSync(absolutePath, constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
  }
  return { exists, writable };
}

function buildPathProbe(cwd: string, filePath: string, checks?: PathProbeMap): PublicPathProbe {
  const displayPath = publicPath(filePath, cwd);
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  return {
    path: displayPath,
    ...probePath(absolutePath, checks?.[displayPath] ?? checks?.[filePath]),
  };
}

function countRecordValues(value: unknown): number {
  if (!isObject(value)) {
    return 0;
  }
  return Object.values(value).reduce<number>((count, entry) => {
    if (typeof entry === "number") {
      return count + entry;
    }
    if (Array.isArray(entry)) {
      return count + entry.length;
    }
    return count + 1;
  }, 0);
}

function sanitizeHardwareStatus(status: HardwareStatus, cwd: string): RuntimeDiagnostics["hardware"] {
  return redactDiagnosticValue({
    ...status,
    binaryPath: publicPath(status.binaryPath, cwd),
    serial: status.serial ? "[redacted]" : "",
  });
}

function buildWarnings(paths: RuntimeDiagnostics["paths"], services: RuntimeDiagnosticsServices): string[] {
  const warnings: string[] = [];
  if (!paths.nativeBinary.exists && services.hardware.state !== "connected") {
    warnings.push("Native HackRF audio binary is missing; run npm run build:native.");
  }
  if (!paths.captures.exists || !paths.captures.writable) {
    warnings.push("Capture storage is missing or not writable.");
  }
  if (services.aisRuntime.state === "error") {
    warnings.push(`AIS runtime error: ${services.aisRuntime.message}`);
  }
  if (services.adsbRuntime.state === "error") {
    warnings.push(`ADS-B runtime error: ${services.adsbRuntime.message}`);
  }
  return warnings;
}

export function buildRuntimeDiagnostics(options: BuildRuntimeDiagnosticsOptions): RuntimeDiagnostics {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const packageInfo = options.packageInfo ?? {
    name: packageJson.name,
    version: packageJson.version,
  };
  const nativeBinaryPath = env.HACKRF_WEBUI_NATIVE_BIN?.trim() || path.join(cwd, "bin", "hackrf_audio_stream");

  const paths: RuntimeDiagnostics["paths"] = {
    projectRoot: buildPathProbe(cwd, cwd, options.pathChecks),
    nativeBinary: buildPathProbe(cwd, nativeBinaryPath, options.pathChecks),
    captures: buildPathProbe(cwd, "data/captures", options.pathChecks),
    runtime: buildPathProbe(cwd, "runtime", options.pathChecks),
    mapsManifest: buildPathProbe(cwd, "public/tiles/osm/manifest.json", options.pathChecks),
    aiAssets: buildPathProbe(cwd, "assets/ai", options.pathChecks),
  };

  const diagnostics: RuntimeDiagnostics = {
    generatedAt: now.toISOString(),
    app: packageInfo,
    system: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
    },
    modes: {
      simulator: isHackrfSimulatorEnabled(env),
      replay: isReplayModeEnabled(env),
      authTokenConfigured: Boolean(env.HACKRF_WEBUI_TOKEN?.trim()),
      publicTokenConfigured: Boolean(env.NEXT_PUBLIC_HACKRF_WEBUI_TOKEN?.trim()),
      allowedOriginsConfigured: Boolean(env.HACKRF_WEBUI_ALLOWED_ORIGINS?.trim()),
    },
    env: Object.fromEntries(ENV_KEYS.map((key) => [key, envState(env, key)])),
    paths,
    hardware: sanitizeHardwareStatus(options.services.hardware, cwd),
    services: {
      ais: redactDiagnosticValue({
        ...options.services.aisRuntime,
        binaryPath: publicPath(options.services.aisRuntime.binaryPath, cwd),
      }),
      adsb: redactDiagnosticValue({
        ...options.services.adsbRuntime,
        binaryPath: publicPath(options.services.adsbRuntime.binaryPath, cwd),
        jsonDir: publicPath(options.services.adsbRuntime.jsonDir, cwd),
      }),
      radio: {
        stats: options.services.supervisor.stats,
        liveSessionCount: options.services.supervisor.stats.liveSessionCount,
        listenerCount: countRecordValues(options.services.supervisor.listeners),
      },
    },
    warnings: [],
  };
  diagnostics.warnings = buildWarnings(paths, options.services);

  return redactDiagnosticValue(diagnostics);
}
