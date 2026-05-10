import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildReplayAdsbSnapshot,
  buildReplayAisSnapshot,
  getReplayAdsbHistory,
  getReplayAisHistory,
  isReplayModeEnabled,
} from "../src/server/replay-feed";

test("isReplayModeEnabled accepts explicit truthy values only", () => {
  for (const value of ["1", "true", "TRUE", "yes", "y", "on", " ON "]) {
    assert.equal(isReplayModeEnabled({ HACKRF_WEBUI_REPLAY: value }), true, value);
  }

  for (const value of [undefined, "", "0", "false", "no", "off", "simulator"]) {
    assert.equal(isReplayModeEnabled({ HACKRF_WEBUI_REPLAY: value }), false, String(value));
  }
});

test("buildReplayAisSnapshot provides a moving synthetic vessel feed", () => {
  const snapshot = buildReplayAisSnapshot(new Date("2026-05-10T12:00:00.000Z"));

  assert.equal(snapshot.runtime.state, "running");
  assert.equal(snapshot.runtime.binaryAvailable, true);
  assert.equal(snapshot.vesselCount, snapshot.vessels.length);
  assert.ok(snapshot.vesselCount >= 2);
  assert.ok(snapshot.movingCount >= 1);
  assert.equal(snapshot.warnings.some((warning) => warning.includes("replay")), true);
  assert.equal(snapshot.channels.length, 2);
  assert.ok(snapshot.bounds);
  assert.ok(snapshot.center);
  assert.equal(snapshot.vessels[0].sourceLabel.startsWith("Replay"), true);
});

test("buildReplayAdsbSnapshot provides airborne replay aircraft and receiver data", () => {
  const snapshot = buildReplayAdsbSnapshot(new Date("2026-05-10T12:00:00.000Z"));

  assert.equal(snapshot.runtime.state, "running");
  assert.equal(snapshot.runtime.binaryAvailable, true);
  assert.equal(snapshot.aircraftCount, snapshot.aircraft.length);
  assert.ok(snapshot.aircraftCount >= 2);
  assert.ok(snapshot.positionCount >= 2);
  assert.ok(snapshot.airborneCount >= 1);
  assert.ok(snapshot.receiver);
  assert.ok(snapshot.stats);
  assert.ok(snapshot.bounds);
  assert.ok(snapshot.center);
  assert.equal(snapshot.aircraft[0].sourceLabel, "Replay ADS-B");
});

test("replay histories are deterministic and limited by identifier", () => {
  const aisSnapshot = buildReplayAisSnapshot(new Date("2026-05-10T12:00:00.000Z"));
  const mmsi = aisSnapshot.vessels[0].mmsi;
  const aisHistory = getReplayAisHistory(mmsi, 2, new Date("2026-05-10T12:00:00.000Z"));
  assert.equal(aisHistory.mmsi, mmsi);
  assert.equal(aisHistory.pointCount, 2);
  assert.equal(aisHistory.points.length, 2);
  assert.ok(aisHistory.firstPositionAt);
  assert.ok(aisHistory.lastPositionAt);

  const adsbSnapshot = buildReplayAdsbSnapshot(new Date("2026-05-10T12:00:00.000Z"));
  const hex = adsbSnapshot.aircraft[0].hex;
  const adsbHistory = getReplayAdsbHistory(hex.toLowerCase(), 2, new Date("2026-05-10T12:00:00.000Z"));
  assert.equal(adsbHistory.hex, hex);
  assert.equal(adsbHistory.pointCount, 2);
  assert.equal(adsbHistory.points.length, 2);
  assert.ok(adsbHistory.firstSeenAt);
  assert.ok(adsbHistory.lastSeenAt);

  assert.equal(getReplayAisHistory("missing", 10).pointCount, 0);
  assert.equal(getReplayAdsbHistory("missing", 10).pointCount, 0);
});
