import assert from "node:assert/strict";
import { test } from "node:test";

import type { RuntimeDiagnosticsServices } from "@/server/runtime-diagnostics";
import {
  buildRuntimeDiagnostics,
  redactDiagnosticValue,
} from "@/server/runtime-diagnostics";

const NOW = new Date("2026-05-11T01:45:00.000Z");

function baseServices(): RuntimeDiagnosticsServices {
  return {
    hardware: {
      state: "connected",
      cliAvailable: true,
      binaryAvailable: true,
      ffmpegAvailable: true,
      binaryPath: "/repo/bin/hackrf_audio_stream",
      product: "HackRF One",
      firmware: "2024.02.1",
      hardware: "r9",
      serial: "0000000000000000feedface12345678",
      message: "HackRF ready to tune.",
      activeStream: null,
    },
    aisRuntime: {
      state: "running",
      message: "AIS replay feed is serving deterministic vessel fixtures.",
      binaryAvailable: true,
      binaryPath: "replay://ais",
      startedAt: NOW.toISOString(),
      lastFrameAt: NOW.toISOString(),
      centerFreqHz: 162_000_000,
      sampleRate: 1_536_000,
    },
    adsbRuntime: {
      state: "running",
      message: "ADS-B replay feed is serving deterministic aircraft fixtures.",
      binaryAvailable: true,
      binaryPath: "replay://adsb",
      startedAt: NOW.toISOString(),
      lastJsonAt: NOW.toISOString(),
      centerFreqHz: 1_090_000_000,
      sampleRate: 2_400_000,
      jsonDir: "replay://adsb-json",
      receiverLatitude: 43.263,
      receiverLongitude: -2.935,
    },
    supervisor: {
      sessions: [],
      scheduler: { owner: null },
      recentSessionEvents: [],
      listeners: {},
      stats: {
        createdCount: 1,
        stoppedCount: 1,
        failedCreateCount: 0,
        failedStopCount: 0,
        liveSessionCount: 0,
      },
    },
  };
}

test("redactDiagnosticValue recursively removes secrets from keys, URLs and bearer values", () => {
  const redacted = redactDiagnosticValue({
    plain: "visible",
    HACKRF_WEBUI_TOKEN: "super-secret-token",
    nested: {
      authorization: "Bearer abcdef1234567890",
      callbackUrl: "https://user:pass@example.test/path?apiToken=abcdef123456&ok=1",
    },
  });

  const json = JSON.stringify(redacted);
  assert.equal(redacted.plain, "visible");
  assert.equal(redacted.HACKRF_WEBUI_TOKEN, "[redacted]");
  assert.match(json, /Bearer \[redacted\]/);
  assert.match(json, /apiToken=\[redacted\]/);
  assert.doesNotMatch(json, /super-secret-token|abcdef1234567890|user:pass|abcdef123456/);
});

test("buildRuntimeDiagnostics reports modes, runtime health and redacted safe paths", () => {
  const diagnostics = buildRuntimeDiagnostics({
    now: NOW,
    cwd: "/repo",
    packageInfo: { name: "hackrf-webui", version: "1.0.0" },
    env: {
      HACKRF_WEBUI_SIMULATOR: "1",
      HACKRF_WEBUI_REPLAY: "true",
      HACKRF_WEBUI_TOKEN: "top-secret-token",
      NEXT_PUBLIC_HACKRF_WEBUI_TOKEN: "public-secret-token",
      HACKRF_WEBUI_ALLOWED_ORIGINS: "https://radio.example.test",
      HACKRF_WEBUI_NATIVE_BIN: "/repo/bin/hackrf_audio_stream",
    },
    services: baseServices(),
    pathChecks: {
      "bin/hackrf_audio_stream": { exists: true, writable: false },
      "data/captures": { exists: true, writable: true },
      "runtime": { exists: true, writable: true },
      "public/tiles/osm/manifest.json": { exists: false, writable: false },
      "assets/ai": { exists: true, writable: false },
    },
  });

  assert.equal(diagnostics.generatedAt, NOW.toISOString());
  assert.deepEqual(diagnostics.app, { name: "hackrf-webui", version: "1.0.0" });
  assert.equal(diagnostics.modes.simulator, true);
  assert.equal(diagnostics.modes.replay, true);
  assert.equal(diagnostics.modes.authTokenConfigured, true);
  assert.equal(diagnostics.hardware.serial, "[redacted]");
  assert.equal(diagnostics.hardware.binaryPath, "bin/hackrf_audio_stream");
  assert.equal(diagnostics.services.ais.state, "running");
  assert.equal(diagnostics.services.adsb.jsonDir, "replay://adsb-json");
  assert.equal(diagnostics.paths.captures.writable, true);
  assert.equal(diagnostics.paths.mapsManifest.exists, false);
  assert.equal(diagnostics.env.HACKRF_WEBUI_TOKEN, "configured");

  const json = JSON.stringify(diagnostics);
  assert.doesNotMatch(json, /top-secret-token|public-secret-token|0000000000000000feedface12345678/);
});
