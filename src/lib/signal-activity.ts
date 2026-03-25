import type { SignalLevelTelemetry } from "@/lib/types";

export const TELEMETRY_REPORT_INTERVAL_MS = 200;
export const ACTIVE_LISTEN_TELEMETRY_REFRESH_MS = 1000;
export const TELEMETRY_REFRESH_MS = 300;
export const SCANNER_STARTUP_MS = 1200;
export const SCANNER_HOLD_GRACE_MS = 2500;

const TELEMETRY_STALE_MS = 1500;

export type ActivityWindowMetrics = {
  rms: number;
  peak: number;
  rf: number;
};

export function createActivityWindowMetrics(): ActivityWindowMetrics {
  return {
    rms: 0,
    peak: 0,
    rf: 0,
  };
}

export function getFreshTelemetry(
  telemetry: SignalLevelTelemetry | null,
  now = Date.now(),
): SignalLevelTelemetry | null {
  if (!telemetry) {
    return null;
  }

  const updatedAtMs = Date.parse(telemetry.updatedAt);
  if (!Number.isFinite(updatedAtMs) || now - updatedAtMs > TELEMETRY_STALE_MS) {
    return null;
  }

  return telemetry;
}

export function hasRmsActivity(
  telemetry: SignalLevelTelemetry | null,
  squelch: number,
  now = Date.now(),
): boolean {
  const freshTelemetry = getFreshTelemetry(telemetry, now);
  return freshTelemetry !== null && freshTelemetry.rms >= squelch;
}

export function mergeActivityWindowMetrics(
  current: ActivityWindowMetrics,
  telemetry: SignalLevelTelemetry | null,
  now = Date.now(),
): ActivityWindowMetrics {
  const freshTelemetry = getFreshTelemetry(telemetry, now);
  if (!freshTelemetry) {
    return current;
  }

  return {
    rms: Math.max(current.rms, freshTelemetry.rms),
    peak: Math.max(current.peak, freshTelemetry.peak),
    rf: Math.max(current.rf, freshTelemetry.rf),
  };
}
