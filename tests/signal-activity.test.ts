import test from "node:test";
import assert from "node:assert/strict";

import {
  getFreshTelemetry,
  hasRmsActivity,
  mergeActivityWindowMetrics,
  normalizeScannerPostHitHoldSeconds,
  shouldReleaseScannerLock,
} from "@/lib/signal-activity";

test("getFreshTelemetry returns only parseable recent telemetry", () => {
  const now = Date.parse("2026-01-01T00:00:02.000Z");
  const recent = { rms: 0.2, peak: 0.4, rf: 0.6, updatedAt: "2026-01-01T00:00:01.000Z" };
  const stale = { ...recent, updatedAt: "2025-12-31T23:59:59.000Z" };

  assert.deepEqual(getFreshTelemetry(recent, now), recent);
  assert.equal(getFreshTelemetry(stale, now), null);
  assert.equal(getFreshTelemetry({ ...recent, updatedAt: "not-a-date" }, now), null);
});

test("activity helpers clamp scanner hold and merge fresh peaks", () => {
  const now = Date.parse("2026-01-01T00:00:02.000Z");
  const current = { rms: 0.1, peak: 0.1, rf: 0.1 };
  const telemetry = { rms: 0.2, peak: 0.4, rf: 0.3, updatedAt: "2026-01-01T00:00:01.000Z" };

  assert.equal(hasRmsActivity(telemetry, 0.15, now), true);
  assert.deepEqual(mergeActivityWindowMetrics(current, telemetry, now), { rms: 0.2, peak: 0.4, rf: 0.3 });
  assert.equal(normalizeScannerPostHitHoldSeconds(Number.NaN), 0);
  assert.equal(normalizeScannerPostHitHoldSeconds(99), 15);
  assert.equal(normalizeScannerPostHitHoldSeconds(1.6), 2);
});

test("scanner lock release waits for both grace and configured hold", () => {
  assert.equal(shouldReleaseScannerLock(10_000, 7_600, 0, 3), false, "still inside activity grace");
  assert.equal(shouldReleaseScannerLock(10_000, 7_000, 8_000, 3), false, "hold time not elapsed");
  assert.equal(shouldReleaseScannerLock(12_000, 7_000, 8_000, 3), true);
});
