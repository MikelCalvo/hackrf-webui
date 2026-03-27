import type { SignalLevelTelemetry, StreamSessionSnapshot } from "@/lib/types";

export const TELEMETRY_REPORT_INTERVAL_MS = 200;
export const ACTIVE_LISTEN_TELEMETRY_REFRESH_MS = 1000;
export const TELEMETRY_REFRESH_MS = 300;
export const SCANNER_STARTUP_MS = 1200;
export const SCANNER_HOLD_GRACE_MS = 2500;
export const SCANNER_ACTIVITY_CONFIRMATION_POLLS = 2;
export const SCANNER_POST_HIT_HOLD_DEFAULT_SECONDS = 0;
export const SCANNER_POST_HIT_HOLD_MAX_SECONDS = 15;

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

export function getRunningStreamTelemetry(
  stream: StreamSessionSnapshot | null,
  now = Date.now(),
): SignalLevelTelemetry | null {
  if (!stream || stream.phase !== "running" || stream.pendingFreqHz !== null) {
    return null;
  }

  return getFreshTelemetry(stream.telemetry, now);
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

export function normalizeScannerPostHitHoldSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    return SCANNER_POST_HIT_HOLD_DEFAULT_SECONDS;
  }

  return Math.max(
    SCANNER_POST_HIT_HOLD_DEFAULT_SECONDS,
    Math.min(SCANNER_POST_HIT_HOLD_MAX_SECONDS, Math.round(seconds)),
  );
}

export function shouldReleaseScannerLock(
  now: number,
  lastActivityAt: number,
  lockedAt: number,
  holdSeconds: number,
): boolean {
  const holdMs = normalizeScannerPostHitHoldSeconds(holdSeconds) * 1000;

  return now - lastActivityAt >= SCANNER_HOLD_GRACE_MS && now - lockedAt >= holdMs;
}
