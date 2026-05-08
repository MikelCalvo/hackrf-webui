import test from "node:test";
import assert from "node:assert/strict";

import {
  createSimulatedAudioStream,
  createSimulatedHardwareStatus,
  createSimulatedSpectrumFrame,
  createSimulatedTelemetry,
  isHackrfSimulatorEnabled,
} from "@/server/hackrf-simulator";

test("isHackrfSimulatorEnabled accepts explicit truthy env values only", () => {
  assert.equal(isHackrfSimulatorEnabled({}), false);
  assert.equal(isHackrfSimulatorEnabled({ HACKRF_WEBUI_SIMULATOR: "0" }), false);
  assert.equal(isHackrfSimulatorEnabled({ HACKRF_WEBUI_SIMULATOR: "off" }), false);
  assert.equal(isHackrfSimulatorEnabled({ HACKRF_WEBUI_SIMULATOR: "1" }), true);
  assert.equal(isHackrfSimulatorEnabled({ HACKRF_WEBUI_SIMULATOR: "true" }), true);
  assert.equal(isHackrfSimulatorEnabled({ HACKRF_WEBUI_SIMULATOR: "YES" }), true);
});

test("createSimulatedHardwareStatus reports a connected virtual HackRF", () => {
  const status = createSimulatedHardwareStatus("/tmp/hackrf_audio_stream", null);

  assert.equal(status.state, "connected");
  assert.equal(status.cliAvailable, true);
  assert.equal(status.binaryAvailable, true);
  assert.equal(status.ffmpegAvailable, true);
  assert.equal(status.binaryPath, "/tmp/hackrf_audio_stream");
  assert.equal(status.product, "HackRF Simulator");
  assert.match(status.message, /simulator/i);
  assert.equal(status.activeStream, null);
});

test("simulated telemetry and spectrum are bounded and tune-aware", () => {
  const now = Date.parse("2026-05-08T19:00:00.000Z");
  const telemetry = createSimulatedTelemetry(446_006_250, now);
  const spectrum = createSimulatedSpectrumFrame(446_006_250, "nfm", now);

  assert.equal(telemetry.updatedAt, new Date(now).toISOString());
  assert.ok(telemetry.rms >= 0 && telemetry.rms <= 80);
  assert.ok(telemetry.peak >= telemetry.rms);
  assert.ok(telemetry.rf >= telemetry.rms);
  assert.equal(spectrum.centerFreqHz, 446_006_250);
  assert.equal(spectrum.spanHz, 200_000);
  assert.equal(spectrum.bins.length, 96);
  assert.ok(spectrum.peakIndex >= 0 && spectrum.peakIndex < spectrum.bins.length);
});

test("createSimulatedAudioStream yields cancellable audio bytes", async () => {
  const abortController = new AbortController();
  let closed = false;
  const simulated = createSimulatedAudioStream({
    signal: abortController.signal,
    chunkIntervalMs: 5,
    onClose: () => {
      closed = true;
    },
  });

  const reader = simulated.stream.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.ok(first.value instanceof Uint8Array);
  assert.ok(first.value.byteLength > 100);

  abortController.abort();
  await reader.cancel();
  simulated.close();
  assert.equal(closed, true);
});
