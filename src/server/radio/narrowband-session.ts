import { randomUUID } from "node:crypto";

import type { ActivityLogEntry } from "@/lib/activity-events";
import type {
  CreateNarrowbandSessionRequest,
  NarrowbandModuleConfig,
  NarrowbandSessionSnapshot,
  RadioSessionChannel,
  UpdateNarrowbandSessionRequest,
} from "@/lib/radio-session";
import { radioSessionChannelDeckSignature } from "@/lib/radio-session";
import type { ActivityCaptureRequestMeta, HardwareStatus, SignalLevelTelemetry, StreamRequest } from "@/lib/types";
import { createCaptureBoundActivityEvent } from "@/server/activity-events";
import { hackrfService } from "@/server/hackrf";
import type { RadioEventBus } from "@/server/radio/event-bus";
import { AudioBroker } from "@/server/radio/audio-broker";
import type { RadioSessionStore } from "@/server/radio/session-store";
import {
  createActivityWindowMetrics,
  getRunningStreamTelemetry,
  hasRmsActivity,
  mergeActivityWindowMetrics,
  normalizeScannerPostHitHoldSeconds,
  SCANNER_ACTIVITY_CONFIRMATION_POLLS,
  SCANNER_HOLD_GRACE_MS,
  SCANNER_POST_HIT_HOLD_DEFAULT_SECONDS,
  SCANNER_STARTUP_MS,
  TELEMETRY_REFRESH_MS,
  shouldReleaseScannerLock,
} from "@/lib/signal-activity";

type SessionState = NarrowbandSessionSnapshot["state"];
type ActivityWindow = ReturnType<typeof createActivityWindowMetrics>;

const MAX_ACTIVITY_LOG = 25;

const MODULE_CONFIG: Record<CreateNarrowbandSessionRequest["module"], NarrowbandModuleConfig> = {
  pmr: {
    module: "pmr",
    demodMode: "nfm",
    label: "PMR",
  },
  airband: {
    module: "airband",
    demodMode: "am",
    label: "AIRBAND",
  },
  maritime: {
    module: "maritime",
    demodMode: "nfm",
    label: "MARITIME",
  },
};

function nowIso(): string {
  return new Date().toISOString();
}

function cloneChannel(channel: RadioSessionChannel | null): RadioSessionChannel | null {
  return channel ? { ...channel } : null;
}

function sameChannel(left: RadioSessionChannel | null, right: RadioSessionChannel | null): boolean {
  return !!left && !!right && left.id === right.id;
}

function streamLabel(channel: RadioSessionChannel): string {
  return channel.label || `${channel.bandId} ${channel.number}`;
}

function resolveRunningChannel(
  channels: RadioSessionChannel[],
  activeStream: HardwareStatus["activeStream"],
  demodMode: NarrowbandModuleConfig["demodMode"],
): RadioSessionChannel | null {
  if (
    !activeStream
    || activeStream.demodMode !== demodMode
    || activeStream.phase !== "running"
    || activeStream.pendingFreqHz !== null
  ) {
    return null;
  }

  return channels.find((channel) => Math.round(channel.freqMhz * 1_000_000) === activeStream.freqHz) ?? null;
}

export class NarrowbandSession {
  readonly id = `${this.request.module}-${randomUUID()}`;

  private readonly config = MODULE_CONFIG[this.request.module];

  private readonly audioBroker = new AudioBroker();

  private scanChannels: RadioSessionChannel[];

  private readonly recentActivity: ActivityLogEntry[] = [];

  private readonly startedAt = nowIso();

  private state: SessionState = "starting";

  private updatedAt = this.startedAt;

  private activeChannel: RadioSessionChannel | null = null;

  private pendingChannel: RadioSessionChannel | null = null;

  private streamId: string | null = null;

  private telemetry: SignalLevelTelemetry | null = null;

  private spectrum = null as NarrowbandSessionSnapshot["spectrum"];

  private currentActivityEventId: string | null = null;

  private currentBurstEventId: string | null = null;

  private lockedAtMs: number | null = null;

  private lastActivityAtMs: number | null = null;

  private settleUntilMs: number | null = null;

  private dwellDeadlineAtMs: number | null = null;

  private scanIndex = 0;

  private tickTimer: ReturnType<typeof setInterval> | null = null;

  private abortController: AbortController | null = null;

  private readerSeq = 0;

  private stopped = false;

  private lastError: string | null = null;

  private confirmedActivePolls = 0;

  private peakWindow: ActivityWindow = createActivityWindowMetrics();

  private manualBurstOpen = false;

  private manualBurstPeakRms = 0;

  private manualBurstStartedAtMs: number | null = null;

  private lastSnapshotPublishAtMs = 0;

  constructor(
    private readonly request: CreateNarrowbandSessionRequest,
    private readonly store: RadioSessionStore,
    private readonly events: RadioEventBus,
  ) {
    this.scanChannels = this.resolveScanChannels();
  }

  private get scanMode(): "sequential" | "random" {
    return this.request.scanMode === "random" ? "random" : "sequential";
  }

  private resolveScanChannels(): RadioSessionChannel[] {
    return this.request.channels.map((channel) => ({ ...channel }));
  }

  private get manualChannel(): RadioSessionChannel | null {
    if (!this.request.manualChannelId) {
      return this.scanChannels[0] ?? null;
    }
    return this.scanChannels.find((channel) => channel.id === this.request.manualChannelId) ?? this.scanChannels[0] ?? null;
  }

  private buildActivityCapture(
    channel: RadioSessionChannel,
    activityEventId: string | null,
    burstEventId: string | null,
  ): ActivityCaptureRequestMeta {
    const location = this.request.location ?? null;
    return {
      module: this.request.module,
      mode: this.request.mode,
      activityEventId,
      burstEventId,
      bandId: channel.bandId,
      channelId: channel.id,
      channelNumber: channel.number,
      channelNotes: channel.notes ?? null,
      squelch: this.request.squelch,
      sourceMode: location?.sourceMode ?? null,
      gpsdFallbackMode: location?.gpsdFallbackMode ?? null,
      sourceStatus: location?.sourceStatus ?? null,
      sourceDetail: location?.sourceDetail ?? null,
      regionId: location?.catalogScope.regionId ?? null,
      regionName: location?.catalogScope.regionName ?? null,
      countryId: location?.catalogScope.countryId ?? null,
      countryCode: location?.catalogScope.countryCode ?? null,
      countryName: location?.catalogScope.countryName ?? null,
      cityId: location?.catalogScope.cityId ?? null,
      cityName: location?.catalogScope.cityName ?? null,
      resolvedLatitude: location?.resolvedPosition?.latitude ?? null,
      resolvedLongitude: location?.resolvedPosition?.longitude ?? null,
    };
  }

  private buildSnapshot(message: string): NarrowbandSessionSnapshot {
    return {
      id: this.id,
      kind: "narrowband",
      module: this.request.module,
      mode: this.request.mode,
      state: this.state,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      controls: this.request.controls,
      squelch: this.request.squelch,
      dwellTime: this.request.dwellTime,
      holdTime: this.request.holdTime,
      scanMode: this.scanMode,
      bandId: this.request.bandId,
      channelDeckSignature: radioSessionChannelDeckSignature(this.scanChannels),
      activeChannel: cloneChannel(this.activeChannel),
      pendingChannel: cloneChannel(this.pendingChannel),
      streamId: this.streamId,
      telemetry: this.telemetry,
      spectrum: this.spectrum,
      currentActivityEventId: this.currentActivityEventId,
      currentBurstEventId: this.currentBurstEventId,
      recentActivity: [...this.recentActivity],
      scanner: {
        channelCount: this.scanChannels.length,
        currentIndex: this.scanIndex,
        lockedAt: this.lockedAtMs ? new Date(this.lockedAtMs).toISOString() : null,
        lastActivityAt: this.lastActivityAtMs ? new Date(this.lastActivityAtMs).toISOString() : null,
        settleUntil: this.settleUntilMs ? new Date(this.settleUntilMs).toISOString() : null,
        dwellDeadlineAt: this.dwellDeadlineAtMs ? new Date(this.dwellDeadlineAtMs).toISOString() : null,
      },
      audioAvailable: this.streamId !== null,
      message,
      lastError: this.lastError,
    };
  }

  private publishSnapshot(message: string, force = false): void {
    this.updatedAt = nowIso();
    const snapshot = this.buildSnapshot(message);
    this.store.set(snapshot);
    const now = Date.now();
    if (!force && now - this.lastSnapshotPublishAtMs < 1000) {
      return;
    }
    this.lastSnapshotPublishAtMs = now;
    this.events.publish({
      type: "snapshot",
      sessionId: this.id,
      snapshot,
    });
  }

  private publishActivity(entry: ActivityLogEntry, message: string): void {
    this.updatedAt = nowIso();
    const snapshot = this.buildSnapshot(message);
    this.store.set(snapshot);
    this.lastSnapshotPublishAtMs = Date.now();
    this.events.publish({
      type: "activity",
      sessionId: this.id,
      entry,
      snapshot,
    });
  }

  private publishError(message: string): void {
    this.lastError = message;
    this.state = "error";
    this.updatedAt = nowIso();
    const snapshot = this.buildSnapshot(message);
    this.store.set(snapshot);
    this.lastSnapshotPublishAtMs = Date.now();
    this.events.publish({
      type: "session-error",
      sessionId: this.id,
      message,
      snapshot,
    });
  }

  getSnapshot(): NarrowbandSessionSnapshot {
    const snapshot = this.store.get(this.id);
    if (snapshot?.kind === "narrowband") {
      return snapshot;
    }
    return this.buildSnapshot(`${this.config.label} session is initializing.`);
  }

  createAudioStream(): ReadableStream<Uint8Array> {
    return this.audioBroker.createStream();
  }

  async start(): Promise<void> {
    const channel = this.request.mode === "manual" ? this.manualChannel : (this.scanChannels[0] ?? null);
    if (!channel) {
      this.publishError(`No ${this.config.label} channels are available for this session.`);
      return;
    }

    await this.startChannel(channel, true);
    this.tickTimer = setInterval(() => this.tick(), TELEMETRY_REFRESH_MS);
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    this.state = "stopping";
    this.publishSnapshot(`Stopping ${this.config.label} session.`, true);

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
    this.pendingChannel = null;
    this.activeChannel = null;
    this.streamId = null;
    this.telemetry = null;
    this.spectrum = null;
    this.currentActivityEventId = null;
    this.currentBurstEventId = null;
    this.store.delete(this.id);
  }

  async update(patch: UpdateNarrowbandSessionRequest): Promise<NarrowbandSessionSnapshot> {
    if (this.stopped) {
      throw new Error(`${this.config.label} session is already stopped.`);
    }

    const previousChannelId = this.pendingChannel?.id ?? this.activeChannel?.id ?? null;
    let restartRequired = false;

    if (patch.controls) {
      this.request.controls = patch.controls;
      restartRequired = true;
    }
    if (patch.squelch !== undefined) {
      this.request.squelch = patch.squelch;
    }
    if (patch.dwellTime !== undefined) {
      this.request.dwellTime = patch.dwellTime;
    }
    if (patch.holdTime !== undefined) {
      this.request.holdTime = normalizeScannerPostHitHoldSeconds(patch.holdTime);
    }
    if (patch.scanMode !== undefined) {
      this.request.scanMode = patch.scanMode;
    }
    if (patch.location !== undefined) {
      this.request.location = patch.location;
    }
    if (patch.bandId !== undefined) {
      this.request.bandId = patch.bandId;
    }
    if (patch.mode !== undefined && patch.mode !== this.request.mode) {
      this.request.mode = patch.mode;
      restartRequired = true;
    }
    if (patch.manualChannelId !== undefined && patch.manualChannelId !== this.request.manualChannelId) {
      this.request.manualChannelId = patch.manualChannelId;
      restartRequired = true;
    }
    if (patch.channels) {
      this.scanChannels = patch.channels.map((channel) => ({ ...channel }));
      restartRequired = true;
    }

    if (this.scanChannels.length === 0) {
      this.publishError(`No ${this.config.label} channels are available for this session.`);
      return this.getSnapshot();
    }

    if (!restartRequired) {
      if (this.activeChannel) {
        this.syncActivityBinding(this.activeChannel, this.currentActivityEventId, this.currentBurstEventId);
      }
      this.publishSnapshot(`${this.config.label} session updated.`, true);
      return this.getSnapshot();
    }

    let nextChannel: RadioSessionChannel | null = null;
    if (this.request.mode === "manual") {
      nextChannel = this.manualChannel;
    } else if (previousChannelId) {
      const matchedIndex = this.scanChannels.findIndex((channel) => channel.id === previousChannelId);
      if (matchedIndex >= 0) {
        this.scanIndex = matchedIndex;
        nextChannel = this.scanChannels[matchedIndex] ?? null;
      }
    }

    if (!nextChannel) {
      this.scanIndex = 0;
      nextChannel = this.request.mode === "manual" ? this.manualChannel : (this.scanChannels[0] ?? null);
    }

    if (!nextChannel) {
      this.publishError(`No ${this.config.label} channels are available for this session.`);
      return this.getSnapshot();
    }

    await this.startChannel(nextChannel, true);
    return this.getSnapshot();
  }

  private buildStreamRequest(channel: RadioSessionChannel): StreamRequest {
    return {
      label: streamLabel(channel),
      freqHz: Math.round(channel.freqMhz * 1_000_000),
      lna: this.request.controls.lna,
      vga: this.request.controls.vga,
      audioGain: this.request.controls.audioGain,
      activityCapture: this.buildActivityCapture(channel, null, null),
    };
  }

  private async startNativeStream(channel: RadioSessionChannel, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const request = this.buildStreamRequest(channel);
    if (this.config.demodMode === "am") {
      return hackrfService.startAmStream(request, signal);
    }
    return hackrfService.startNfmStream(request, signal);
  }

  private async startChannel(channel: RadioSessionChannel, forceRestart: boolean): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.pendingChannel = channel;
    this.activeChannel = forceRestart ? channel : this.activeChannel;
    this.state = forceRestart ? "starting" : "tuning";
    this.confirmedActivePolls = 0;
    this.peakWindow = createActivityWindowMetrics();
    this.manualBurstOpen = false;
    this.manualBurstPeakRms = 0;
    this.manualBurstStartedAtMs = null;
    this.currentActivityEventId = null;
    this.currentBurstEventId = null;
    this.lastActivityAtMs = null;
    this.lockedAtMs = null;
    this.publishSnapshot(`${streamLabel(channel)} is tuning.`, true);

    const activeStream = hackrfService.getStatus().activeStream;
    const canRetuneInPlace = !forceRestart
      && !!activeStream
      && activeStream.id === this.streamId
      && activeStream.demodMode === this.config.demodMode
      && activeStream.phase === "running"
      && activeStream.pendingFreqHz === null
      && activeStream.lna === this.request.controls.lna
      && activeStream.vga === this.request.controls.vga
      && Math.abs(activeStream.audioGain - this.request.controls.audioGain) < 0.001;

    if (canRetuneInPlace && this.streamId) {
      const ok = hackrfService.retune(
        Math.round(channel.freqMhz * 1_000_000),
        streamLabel(channel),
        this.config.demodMode,
        this.buildActivityCapture(channel, null, null),
        this.streamId,
      );
      if (ok) {
        this.state = "tuning";
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
    this.state = "starting";
    this.publishSnapshot(`Starting ${this.config.label} stream on ${streamLabel(channel)}.`, true);

    try {
      const stream = await this.startNativeStream(channel, abortController.signal);
      const hardware = hackrfService.getStatus();
      this.streamId = hardware.activeStream?.id ?? null;
      this.pendingChannel = null;
      this.activeChannel = channel;
      this.state = "settling";
      this.settleUntilMs = Date.now() + SCANNER_STARTUP_MS;
      this.dwellDeadlineAtMs =
        this.request.mode === "scan" ? this.settleUntilMs + (this.request.dwellTime * 1000) : null;
      this.publishSnapshot(`${streamLabel(channel)} is settling.`, true);
      this.drainAudioStream(stream, this.readerSeq);
    } catch (error) {
      this.publishError(error instanceof Error ? error.message : `Could not start ${this.config.label} server-side stream.`);
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
        this.publishError(error instanceof Error ? error.message : `${this.config.label} audio source failed.`);
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // Ignore reader cancellation failures.
      }
    }
  }

  private createActivityLog(channel: RadioSessionChannel, rms: number): ActivityLogEntry {
    const entry = createCaptureBoundActivityEvent({
      module: this.request.module,
      mode: this.request.mode,
      label: channel.label,
      freqMhz: channel.freqMhz,
      rms,
      occurredAt: nowIso(),
      bandId: channel.bandId,
      channelId: channel.id,
      channelNumber: channel.number,
      demodMode: this.config.demodMode,
      squelch: this.request.squelch,
      location: this.request.location ?? null,
      metadata: {
        radioSessionId: this.id,
        streamId: this.streamId,
      },
    });
    this.recentActivity.unshift(entry);
    this.recentActivity.splice(MAX_ACTIVITY_LOG);
    return entry;
  }

  private syncActivityBinding(
    channel: RadioSessionChannel,
    activityEventId: string | null,
    burstEventId: string | null,
  ): void {
    if (!this.streamId) {
      return;
    }

    hackrfService.retune(
      Math.round(channel.freqMhz * 1_000_000),
      streamLabel(channel),
      this.config.demodMode,
      this.buildActivityCapture(channel, activityEventId, burstEventId),
      this.streamId,
    );
  }

  private async advanceScan(): Promise<void> {
    if (this.request.mode !== "scan" || this.scanChannels.length === 0 || this.stopped) {
      return;
    }

    if (this.scanChannels.length === 1) {
      this.scanIndex = 0;
    } else if (this.scanMode === "random") {
      let nextIndex = this.scanIndex;
      while (nextIndex === this.scanIndex) {
        nextIndex = Math.floor(Math.random() * this.scanChannels.length);
      }
      this.scanIndex = nextIndex;
    } else {
      this.scanIndex = (this.scanIndex + 1) % this.scanChannels.length;
    }

    const nextChannel = this.scanChannels[this.scanIndex] ?? null;
    if (!nextChannel) {
      this.publishError(`${this.config.label} scan has no next channel.`);
      return;
    }

    await this.startChannel(nextChannel, false);
  }

  private onActivityStart(channel: RadioSessionChannel, rms: number, nowMs: number): void {
    const entry = this.createActivityLog(channel, rms);
    this.currentActivityEventId = entry.id;
    this.currentBurstEventId = entry.burstEventId;
    this.lastActivityAtMs = nowMs;
    this.lockedAtMs = this.request.mode === "scan" ? nowMs : null;
    this.syncActivityBinding(channel, entry.id, entry.burstEventId);

    if (this.request.mode === "scan") {
      this.state = "locked";
      this.publishActivity(entry, `${streamLabel(channel)} locked with activity.`);
      return;
    }

    this.manualBurstOpen = true;
    this.manualBurstPeakRms = rms;
    this.manualBurstStartedAtMs = nowMs;
    this.state = "active";
    this.publishActivity(entry, `${streamLabel(channel)} activity detected.`);
  }

  private onManualActivityClosed(channel: RadioSessionChannel): void {
    this.manualBurstOpen = false;
    this.manualBurstPeakRms = 0;
    this.manualBurstStartedAtMs = null;
    this.currentActivityEventId = null;
    this.currentBurstEventId = null;
    this.syncActivityBinding(channel, null, null);
    this.state = "monitoring";
    this.publishSnapshot(`${streamLabel(channel)} is monitoring.`, true);
  }

  private tick(): void {
    if (this.stopped) {
      return;
    }

    const hardware = hackrfService.getStatus();
    const activeStream = hardware.activeStream;
    this.telemetry = getRunningStreamTelemetry(activeStream);
    const spectrumFeed = hackrfService.getSpectrumFeed();
    this.spectrum = spectrumFeed.owner === "audio" ? spectrumFeed.frame : null;

    if (!activeStream || (this.streamId && activeStream.id !== this.streamId)) {
      return;
    }

    if (!this.streamId) {
      this.streamId = activeStream.id;
    }

    if (this.pendingChannel && activeStream.phase === "running" && activeStream.freqHz === Math.round(this.pendingChannel.freqMhz * 1_000_000)) {
      this.activeChannel = this.pendingChannel;
      this.pendingChannel = null;
      this.state = "settling";
      this.settleUntilMs = Date.now() + SCANNER_STARTUP_MS;
      this.dwellDeadlineAtMs =
        this.request.mode === "scan" ? this.settleUntilMs + (this.request.dwellTime * 1000) : null;
      this.confirmedActivePolls = 0;
      this.peakWindow = createActivityWindowMetrics();
      this.publishSnapshot(`${streamLabel(this.activeChannel)} retuned and settling.`, true);
      return;
    }

    const nowMs = Date.now();
    const activeChannel = this.request.mode === "scan"
      ? resolveRunningChannel(this.scanChannels, activeStream, this.config.demodMode)
      : resolveRunningChannel(this.manualChannel ? [this.manualChannel] : [], activeStream, this.config.demodMode);

    if (!activeChannel || (this.activeChannel && !sameChannel(activeChannel, this.activeChannel))) {
      this.publishSnapshot(`Waiting for ${this.config.label} tune confirmation.`);
      return;
    }

    if (this.state === "settling" && this.settleUntilMs && nowMs >= this.settleUntilMs) {
      this.state = "monitoring";
      this.publishSnapshot(`${streamLabel(activeChannel)} is monitoring.`, true);
    }

    if (this.request.mode === "manual") {
      this.tickManual(activeChannel, nowMs);
      return;
    }

    this.tickScan(activeChannel, nowMs);
  }

  private tickManual(channel: RadioSessionChannel, nowMs: number): void {
    const telemetry = this.telemetry;
    if (!telemetry) {
      this.publishSnapshot(`${streamLabel(channel)} is monitoring.`);
      return;
    }

    if (hasRmsActivity(telemetry, this.request.squelch, nowMs)) {
      this.lastActivityAtMs = nowMs;
      this.manualBurstPeakRms = Math.max(this.manualBurstPeakRms, telemetry.rms);
      if (!this.manualBurstOpen) {
        this.confirmedActivePolls += 1;
        if (this.confirmedActivePolls >= SCANNER_ACTIVITY_CONFIRMATION_POLLS) {
          this.onActivityStart(channel, telemetry.rms, nowMs);
          this.confirmedActivePolls = 0;
        }
      } else {
        this.state = "active";
        this.publishSnapshot(`${streamLabel(channel)} activity is active.`);
      }
      return;
    }

    this.confirmedActivePolls = 0;
    if (!this.manualBurstOpen || !this.lastActivityAtMs) {
      this.state = "monitoring";
      this.publishSnapshot(`${streamLabel(channel)} is monitoring.`);
      return;
    }

    if (nowMs - this.lastActivityAtMs < SCANNER_HOLD_GRACE_MS) {
      return;
    }

    this.onManualActivityClosed(channel);
  }

  private tickScan(channel: RadioSessionChannel, nowMs: number): void {
    const telemetry = this.telemetry;
    this.peakWindow = mergeActivityWindowMetrics(this.peakWindow, telemetry, nowMs);

    if (this.state === "locked") {
      if (hasRmsActivity(telemetry, this.request.squelch, nowMs)) {
        this.lastActivityAtMs = nowMs;
        this.publishSnapshot(`${streamLabel(channel)} remains locked.`);
        return;
      }

      if (
        !this.lastActivityAtMs
        || !this.lockedAtMs
        || !shouldReleaseScannerLock(
          nowMs,
          this.lastActivityAtMs,
          this.lockedAtMs,
          normalizeScannerPostHitHoldSeconds(this.request.holdTime ?? SCANNER_POST_HIT_HOLD_DEFAULT_SECONDS),
        )
      ) {
        return;
      }

      this.currentActivityEventId = null;
      this.currentBurstEventId = null;
      void this.advanceScan();
      return;
    }

    if (this.state !== "monitoring") {
      this.publishSnapshot(`${streamLabel(channel)} is settling.`);
      return;
    }

    if (hasRmsActivity(telemetry, this.request.squelch, nowMs)) {
      this.confirmedActivePolls += 1;
      this.lastActivityAtMs = nowMs;
      if (this.confirmedActivePolls >= SCANNER_ACTIVITY_CONFIRMATION_POLLS) {
        this.onActivityStart(channel, this.peakWindow.rms || telemetry?.rms || 0, nowMs);
        this.confirmedActivePolls = 0;
      }
      return;
    }

    this.confirmedActivePolls = 0;
    if (this.dwellDeadlineAtMs && nowMs >= this.dwellDeadlineAtMs) {
      void this.advanceScan();
      return;
    }

    this.publishSnapshot(`${streamLabel(channel)} is scanning.`);
  }
}
