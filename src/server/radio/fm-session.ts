import { randomUUID } from "node:crypto";

import type {
  CreateFmSessionRequest,
  FmSessionSnapshot,
  RadioSessionFmStation,
  RadioSessionSnapshot,
  UpdateFmSessionRequest,
} from "@/lib/radio-session";
import { hackrfService } from "@/server/hackrf";
import { AudioBroker } from "@/server/radio/audio-broker";
import type { RadioEventBus } from "@/server/radio/event-bus";
import type { RadioSessionStore } from "@/server/radio/session-store";

const FM_TELEMETRY_POLL_MS = 300;

function nowIso(): string {
  return new Date().toISOString();
}

function cloneStation(station: RadioSessionFmStation | null): RadioSessionFmStation | null {
  return station ? { ...station } : null;
}

function sameStation(left: RadioSessionFmStation | null, right: RadioSessionFmStation | null): boolean {
  return !!left && !!right && left.id === right.id && Math.abs(left.freqMhz - right.freqMhz) < 0.000001;
}

function sameControls(
  left: CreateFmSessionRequest["controls"],
  right: CreateFmSessionRequest["controls"],
): boolean {
  return (
    left.lna === right.lna
    && left.vga === right.vga
    && Math.abs(left.audioGain - right.audioGain) < 0.001
  );
}

function streamLabel(station: RadioSessionFmStation): string {
  return station.name || `${station.freqMhz.toFixed(1)} MHz`;
}

export class FmSession {
  readonly id = `fm-${randomUUID()}`;

  private readonly audioBroker = new AudioBroker();

  private readonly createdAt = nowIso();

  private updatedAt = this.createdAt;

  private state: FmSessionSnapshot["state"] = "starting";

  private streamId: string | null = null;

  private activeStation: RadioSessionFmStation | null = null;

  private pendingStation: RadioSessionFmStation | null = null;

  private telemetry: FmSessionSnapshot["telemetry"] = null;

  private spectrum: FmSessionSnapshot["spectrum"] = null;

  private lastError: string | null = null;

  private stopped = false;

  private abortController: AbortController | null = null;

  private readerSeq = 0;

  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly request: CreateFmSessionRequest,
    private readonly store: RadioSessionStore,
    private readonly events: RadioEventBus,
  ) {}

  private buildSnapshot(message: string): FmSessionSnapshot {
    return {
      id: this.id,
      kind: "fm",
      module: "fm",
      state: this.state,
      startedAt: this.createdAt,
      updatedAt: this.updatedAt,
      controls: this.request.controls,
      activeStation: cloneStation(this.activeStation),
      pendingStation: cloneStation(this.pendingStation),
      streamId: this.streamId,
      telemetry: this.telemetry,
      spectrum: this.spectrum,
      audioAvailable: this.streamId !== null,
      message,
      lastError: this.lastError,
    };
  }

  private publishSnapshot(message: string): void {
    this.updatedAt = nowIso();
    const snapshot = this.buildSnapshot(message);
    this.store.set(snapshot);
    this.events.publish({
      type: "snapshot",
      sessionId: this.id,
      snapshot,
    });
  }

  private publishError(message: string): void {
    this.lastError = message;
    this.state = "error";
    this.updatedAt = nowIso();
    const snapshot = this.buildSnapshot(message);
    this.store.set(snapshot);
    this.events.publish({
      type: "session-error",
      sessionId: this.id,
      message,
      snapshot,
    });
  }

  getSnapshot(): RadioSessionSnapshot {
    const snapshot = this.store.get(this.id);
    if (snapshot?.kind === "fm") {
      return snapshot;
    }
    return this.buildSnapshot("FM session is initializing.");
  }

  createAudioStream(): ReadableStream<Uint8Array> {
    return this.audioBroker.createStream();
  }

  async start(): Promise<void> {
    await this.startStation(this.request.station, true);
    this.tickTimer = setInterval(() => this.tick(), FM_TELEMETRY_POLL_MS);
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    this.state = "stopping";
    this.publishSnapshot("Stopping FM session.");

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    this.readerSeq += 1;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.audioBroker.close();
    this.state = "stopped";
    this.streamId = null;
    this.pendingStation = null;
    this.activeStation = null;
    this.telemetry = null;
    this.spectrum = null;
  }

  async update(patch: UpdateFmSessionRequest): Promise<RadioSessionSnapshot> {
    if (this.stopped) {
      throw new Error("FM session is already stopped.");
    }

    const nextControls = patch.controls ?? this.request.controls;
    const nextStation = patch.station ?? this.request.station;
    const controlsChanged = !sameControls(nextControls, this.request.controls);
    const stationChanged = !sameStation(nextStation, this.request.station);

    this.request.controls = nextControls;
    this.request.station = nextStation;

    if (!controlsChanged && !stationChanged) {
      this.publishSnapshot(`${streamLabel(this.request.station)} remains on air.`);
      return this.getSnapshot();
    }

    await this.startStation(nextStation, controlsChanged);
    return this.getSnapshot();
  }

  private buildMessage(station: RadioSessionFmStation): string {
    if (this.state === "tuning") {
      return `Retuning FM to ${streamLabel(station)}.`;
    }
    if (this.state === "starting") {
      return `Starting FM on ${streamLabel(station)}.`;
    }
    return `${streamLabel(station)} is on air.`;
  }

  private async startNativeStream(
    station: RadioSessionFmStation,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    return hackrfService.startWfmStream(
      {
        label: streamLabel(station),
        freqHz: Math.round(station.freqMhz * 1_000_000),
        lna: this.request.controls.lna,
        vga: this.request.controls.vga,
        audioGain: this.request.controls.audioGain,
      },
      signal,
    );
  }

  private async startStation(station: RadioSessionFmStation, forceRestart: boolean): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.lastError = null;
    this.pendingStation = station;
    this.activeStation = forceRestart ? station : this.activeStation;
    this.state = forceRestart ? "starting" : "tuning";
    this.publishSnapshot(this.buildMessage(station));

    const activeStream = hackrfService.getStatus().activeStream;
    const canRetuneInPlace = !forceRestart
      && !!activeStream
      && activeStream.id === this.streamId
      && activeStream.demodMode === "wfm"
      && activeStream.phase === "running"
      && activeStream.pendingFreqHz === null
      && activeStream.lna === this.request.controls.lna
      && activeStream.vga === this.request.controls.vga
      && Math.abs(activeStream.audioGain - this.request.controls.audioGain) < 0.001;

    if (canRetuneInPlace && this.streamId) {
      const ok = hackrfService.retune(
        Math.round(station.freqMhz * 1_000_000),
        streamLabel(station),
        "wfm",
        null,
        this.streamId,
      );
      if (ok) {
        return;
      }
    }

    this.readerSeq += 1;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    const abortController = new AbortController();
    this.abortController = abortController;

    try {
      const stream = await this.startNativeStream(station, abortController.signal);
      const hardware = hackrfService.getStatus();
      this.streamId = hardware.activeStream?.id ?? null;
      this.pendingStation = null;
      this.activeStation = station;
      this.state = "active";
      this.publishSnapshot(this.buildMessage(station));
      void this.drainAudioStream(stream, this.readerSeq);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start the FM session.";
      this.publishError(message);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  private async drainAudioStream(stream: ReadableStream<Uint8Array>, readerToken: number): Promise<void> {
    const reader = stream.getReader();
    try {
      while (!this.stopped && readerToken === this.readerSeq) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value && value.byteLength > 0) {
          this.audioBroker.broadcast(value);
        }
      }
    } catch (error) {
      if (!this.stopped && readerToken === this.readerSeq) {
        this.publishError(error instanceof Error ? error.message : "FM audio source failed.");
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // Ignore reader cancellation failures.
      }
    }
  }

  private tick(): void {
    if (this.stopped) {
      return;
    }

    const hardware = hackrfService.getStatus();
    const activeStream = hardware.activeStream;
    this.telemetry =
      activeStream && activeStream.demodMode === "wfm" && activeStream.phase === "running" && activeStream.pendingFreqHz === null
        ? activeStream.telemetry
        : null;

    const spectrumFeed = hackrfService.getSpectrumFeed();
    this.spectrum =
      spectrumFeed.owner === "audio" && spectrumFeed.stream?.demodMode === "wfm"
        ? spectrumFeed.frame
        : null;

    if (!activeStream || (this.streamId && activeStream.id !== this.streamId)) {
      this.publishSnapshot("Waiting for FM stream confirmation.");
      return;
    }

    if (!this.streamId) {
      this.streamId = activeStream.id;
    }

    if (
      this.pendingStation
      && activeStream.phase === "running"
      && activeStream.freqHz === Math.round(this.pendingStation.freqMhz * 1_000_000)
    ) {
      this.activeStation = this.pendingStation;
      this.pendingStation = null;
      this.state = "active";
      this.publishSnapshot(this.buildMessage(this.activeStation));
      return;
    }

    if (activeStream.phase === "retuning") {
      this.state = "tuning";
    } else if (activeStream.phase === "starting") {
      this.state = "starting";
    } else {
      this.state = "active";
    }

    const station = this.pendingStation ?? this.activeStation ?? this.request.station;
    this.publishSnapshot(this.buildMessage(station));
  }
}
