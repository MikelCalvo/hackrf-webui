"use client";

import type { HardwareStatus, SignalLevelTelemetry, StreamSessionSnapshot } from "@/lib/types";

export const UI_HARDWARE_PUBLISH_INTERVAL_MS = 1000;

export async function fetchHardwareStatusSnapshot(): Promise<HardwareStatus> {
  const response = await fetch("/api/hardware", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not read HackRF status (${response.status}).`);
  }

  return (await response.json()) as HardwareStatus;
}

function roundTelemetryValue(value: number): string {
  return value.toFixed(4);
}

function telemetrySignature(telemetry: SignalLevelTelemetry | null | undefined): string {
  if (!telemetry) {
    return "none";
  }

  return [
    roundTelemetryValue(telemetry.rms),
    roundTelemetryValue(telemetry.peak),
    roundTelemetryValue(telemetry.rf),
  ].join("|");
}

function streamSignature(stream: StreamSessionSnapshot | null): string {
  if (!stream) {
    return "none";
  }

  return [
    stream.id,
    stream.demodMode,
    stream.freqHz,
    stream.label,
    stream.phase,
    stream.pendingFreqHz ?? "",
    stream.pendingLabel ?? "",
    stream.lna,
    stream.vga,
    stream.audioGain,
  ].join("|");
}

export function shouldPublishHardwareSnapshot(
  current: HardwareStatus | null,
  next: HardwareStatus,
  lastPublishedAtMs: number,
  nowMs = Date.now(),
  publishIntervalMs = UI_HARDWARE_PUBLISH_INTERVAL_MS,
): boolean {
  if (!current) {
    return true;
  }

  if (
    current.state !== next.state
    || current.message !== next.message
    || current.cliAvailable !== next.cliAvailable
    || current.binaryAvailable !== next.binaryAvailable
    || current.ffmpegAvailable !== next.ffmpegAvailable
    || current.binaryPath !== next.binaryPath
    || current.product !== next.product
    || current.firmware !== next.firmware
    || current.hardware !== next.hardware
    || current.serial !== next.serial
  ) {
    return true;
  }

  if (streamSignature(current.activeStream) !== streamSignature(next.activeStream)) {
    return true;
  }

  if (telemetrySignature(current.activeStream?.telemetry) === telemetrySignature(next.activeStream?.telemetry)) {
    return false;
  }

  return nowMs - lastPublishedAtMs >= publishIntervalMs;
}
