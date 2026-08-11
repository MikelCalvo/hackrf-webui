import { randomUUID } from "node:crypto";

import type {
  CreateMorseSessionRequest,
  MorseDecodeSnapshot,
  MorseSessionSnapshot,
  RadioSessionChannel,
  RadioSessionSnapshot,
  UpdateMorseSessionRequest,
} from "@/lib/radio-session";
import { createMorseRuntime, type MorseRuntime } from "@/lib/morse-runtime";
import { hackrfService } from "@/server/hackrf";
import { buildMorsePersistenceRecords, type MorseAnalysisResult } from "@/server/morse-persistence";
import { bindMorseResultToCaptureEvidence, persistMorsePersistenceRecords } from "@/server/morse-persistence-store";
import { AudioBroker } from "@/server/radio/audio-broker";
import type { RadioEventBus } from "@/server/radio/event-bus";
import type { RadioSessionStore } from "@/server/radio/session-store";

const EMPTY_DECODE: MorseDecodeSnapshot = {
  text: "",
  rawMorse: "",
  confidence: 0,
  dotMs: null,
  wordsPerMinute: null,
  toneHz: null,
  holdState: "SCANNING",
  expectedIdentifier: null,
  identifierMatch: null,
};
const TICK_MS = 250;

function nowIso(): string { return new Date().toISOString(); }

export class MorseSession {
  readonly id = `morse-${randomUUID()}`;
  private readonly audioBroker = new AudioBroker();
  private readonly createdAt = nowIso();
  private state: MorseSessionSnapshot["state"] = "starting";
  private channels: RadioSessionChannel[];
  private currentIndex = 0;
  private activeChannel: RadioSessionChannel | null = null;
  private pendingChannel: RadioSessionChannel | null = null;
  private streamId: string | null = null;
  private telemetry: MorseSessionSnapshot["telemetry"] = null;
  private spectrum: MorseSessionSnapshot["spectrum"] = null;
  private decode: MorseDecodeSnapshot = { ...EMPTY_DECODE };
  private lastError: string | null = null;
  private message = "MORSE session is initializing.";
  private abortController: AbortController | null = null;
  private readerSeq = 0;
  private stopped = false;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private dwellTimer: ReturnType<typeof setTimeout> | null = null;
  private updatedAt = this.createdAt;
  private morseRuntime: MorseRuntime | null = null;
  private pendingAnalysis: MorseAnalysisResult | null = null;
  private persistedCaptureIds = new Set<string>();

  private expectedIdentifier(): string | null {
    const channel = this.pendingChannel ?? this.activeChannel;
    return channel?.expectedIdentifier?.trim().toUpperCase() || null;
  }

  private identifierMatch(decodedText: string, confidence: number): boolean | null {
    const expected = this.expectedIdentifier();
    if (!expected || confidence < 0.6 || !decodedText.trim()) return null;
    const tokens = decodedText.toUpperCase().split(/[^A-Z0-9/]+/).filter(Boolean);
    return tokens.includes(expected);
  }

  constructor(
    private request: CreateMorseSessionRequest,
    private readonly store: RadioSessionStore,
    private readonly events: RadioEventBus,
  ) {
    this.channels = [...request.channels];
    const requestedIndex = request.manualChannelId
      ? this.channels.findIndex((channel) => channel.id === request.manualChannelId)
      : 0;
    this.currentIndex = requestedIndex >= 0 ? requestedIndex : 0;
  }

  getSnapshot(): RadioSessionSnapshot {
    return this.store.get(this.id) ?? this.buildSnapshot();
  }

  createAudioStream(): ReadableStream<Uint8Array> {
    return this.audioBroker.createStream();
  }

  async start(): Promise<void> {
    const channel = this.channels[this.currentIndex];
    if (!channel) {
      throw new Error("MORSE session has no compatible tunable channels.");
    }
    await this.startChannel(channel, true);
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    if (this.request.mode === "scan") this.scheduleNextChannel();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.state = "stopping";
    this.message = "Stopping MORSE session.";
    this.publishSnapshot();
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.dwellTimer) clearTimeout(this.dwellTimer);
    this.tickTimer = null;
    this.dwellTimer = null;
    this.readerSeq += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.audioBroker.close();
    this.state = "stopped";
    this.streamId = null;
    this.activeChannel = null;
    this.pendingChannel = null;
    this.telemetry = null;
    this.spectrum = null;
  }

  async close(): Promise<void> { await this.stop(); }

  async update(patch: UpdateMorseSessionRequest): Promise<RadioSessionSnapshot> {
    if (this.stopped) throw new Error("MORSE session is already stopped.");
    if (patch.channels) this.channels = [...patch.channels];
    if (patch.controls) this.request = { ...this.request, controls: patch.controls };
    if (patch.frontEnd) this.request = { ...this.request, frontEnd: patch.frontEnd };
    if (patch.mode) this.request = { ...this.request, mode: patch.mode };
    if (patch.scanMode) this.request = { ...this.request, scanMode: patch.scanMode };
    if (patch.squelch !== undefined) this.request = { ...this.request, squelch: patch.squelch };
    if (patch.dwellTime !== undefined) this.request = { ...this.request, dwellTime: patch.dwellTime };
    if (patch.holdTime !== undefined) this.request = { ...this.request, holdTime: patch.holdTime };
    if (patch.manualChannelId !== undefined) {
      this.request = { ...this.request, manualChannelId: patch.manualChannelId ?? undefined };
      const index = this.channels.findIndex((channel) => channel.id === patch.manualChannelId);
      if (index >= 0) await this.startChannel(this.channels[index], false);
    }
    this.publishSnapshot();
    return this.getSnapshot();
  }

  private buildSnapshot(): MorseSessionSnapshot {
    return {
      id: this.id,
      kind: "morse",
      module: "morse",
      state: this.state,
      mode: this.request.mode,
      frontEnd: this.request.frontEnd,
      startedAt: this.createdAt,
      updatedAt: this.updatedAt,
      controls: this.request.controls,
      bandId: this.request.bandId,
      channels: this.channels,
      scanMode: this.request.scanMode ?? "sequential",
      manualChannelId: this.request.manualChannelId ?? null,
      squelch: this.request.squelch,
      dwellTime: this.request.dwellTime,
      holdTime: this.request.holdTime,
      location: this.request.location ?? null,
      activeChannel: this.activeChannel,
      pendingChannel: this.pendingChannel,
      streamId: this.streamId,
      scanner: {
        channelCount: this.channels.length,
        currentIndex: this.activeChannel ? this.currentIndex : null,
        holdState: this.decode.holdState,
      },
      telemetry: this.telemetry,
      spectrum: this.spectrum,
      audioAvailable: this.streamId !== null,
      message: this.message,
      lastError: this.lastError,
      decode: { ...this.decode },
    };
  }

  private publishSnapshot(): void {
    this.updatedAt = nowIso();
    const snapshot = this.buildSnapshot();
    this.store.set(snapshot);
    this.events.publish({ type: "snapshot", sessionId: this.id, snapshot });
  }

  private async startChannel(channel: RadioSessionChannel, forceRestart: boolean): Promise<void> {
    // A retune changes both the expected identifier and the RF evidence source.
    // Never carry timing/HOLD state from the previous frequency into the next channel.
    this.morseRuntime?.reset();
    this.decode = {
      ...EMPTY_DECODE,
      expectedIdentifier: channel.expectedIdentifier?.trim().toUpperCase() || null,
    };
    this.pendingAnalysis = null;
    this.pendingChannel = channel;
    this.state = forceRestart ? "starting" : "tuning";
    this.message = `${forceRestart ? "Starting" : "Tuning"} MORSE on ${channel.label}.`;
    this.publishSnapshot();

    const mode = this.request.frontEnd === "am_tone" ? "am" : "cw";
    const active = hackrfService.getStatus().activeStream;
    const canRetune = !forceRestart && active?.id === this.streamId && active.demodMode === mode && active.phase === "running";
    if (canRetune && this.streamId && hackrfService.retune(
      Math.round(channel.freqMhz * 1_000_000),
      channel.label,
      mode,
      { module: "morse", mode: this.request.mode, bandId: this.request.bandId },
      this.streamId,
    )) return;

    this.readerSeq += 1;
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    const stream = mode === "am"
      ? await hackrfService.startAmStream(this.streamRequest(channel), controller.signal)
      : await hackrfService.startCwStream(this.streamRequest(channel), controller.signal);
    this.streamId = hackrfService.getStatus().activeStream?.id ?? null;
    this.activeChannel = channel;
    this.pendingChannel = null;
    this.currentIndex = Math.max(0, this.channels.findIndex((item) => item.id === channel.id));
    this.state = "active";
    this.message = `${this.request.mode === "scan" ? "Scanning" : "Listening to"} ${channel.label}.`;
    this.publishSnapshot();
    void this.drainAudio(stream, this.readerSeq);
  }

  private streamRequest(channel: RadioSessionChannel) {
    return {
      label: channel.label,
      freqHz: Math.round(channel.freqMhz * 1_000_000),
      lna: this.request.controls.lna,
      vga: this.request.controls.vga,
      audioGain: this.request.controls.audioGain,
      activityCapture: { module: "morse" as const, mode: this.request.mode, bandId: this.request.bandId },
      onMorsePcm: (samples: Float32Array, sampleRate: number) => this.processMorsePcm(samples, sampleRate),
      onCapturePersisted: (captureSessionId: string) => { void this.persistCompletedDecode(captureSessionId); },
    };
  }

  private processMorsePcm(samples: Float32Array, sampleRate: number): void {
    if (!this.morseRuntime) {
      this.morseRuntime = this.runtimeFactory({
        sampleRate,
        toneHz: this.request.frontEnd === "am_tone" ? 1_020 : 700,
        toneSearchHz: this.request.frontEnd === "am_tone" ? 120 : 100,
        minSnrDb: 7,
        candidateConfirmationCount: 2,
        activityGraceMs: Math.max(250, this.request.dwellTime * 250),
        endOfTransmissionSilenceMs: Math.max(700, this.request.holdTime * 250),
        postHoldMs: 500,
      });
    }
    const result = this.morseRuntime.process(samples);
    const current = result.completedDecode ?? result.partialDecode;
    this.decode = {
      text: current.text,
      rawMorse: current.rawGroups.join(" "),
      confidence: current.confidence,
      dotMs: current.dotDurationMs,
      wordsPerMinute: current.wordsPerMinute,
      toneHz: Number.isFinite(result.metrics.toneHz) ? result.metrics.toneHz : null,
      holdState: result.hold.state,
      expectedIdentifier: this.expectedIdentifier(),
      identifierMatch: this.identifierMatch(current.text, current.confidence),
    };
    if (result.completedDecode) {
      this.pendingAnalysis = this.toAnalysisResult(result.completedDecode);
    }
    this.publishSnapshot();
  }

  private async drainAudio(stream: ReadableStream<Uint8Array>, token: number): Promise<void> {
    const reader = stream.getReader();
    try {
      while (!this.stopped && token === this.readerSeq) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.byteLength) this.audioBroker.broadcast(value);
      }
    } catch (error) {
      if (!this.stopped && token === this.readerSeq) {
        this.lastError = error instanceof Error ? error.message : "MORSE audio source failed.";
        this.state = "error";
        this.publishSnapshot();
      }
    } finally {
      try { await reader.cancel(); } catch { /* ignore */ }
    }
  }

  private scheduleNextChannel(): void {
    if (this.dwellTimer) clearTimeout(this.dwellTimer);
    this.dwellTimer = setTimeout(() => {
      if (this.stopped) return;
      if (this.decode.holdState === "HOLD" || this.decode.holdState === "DECODING") {
        this.scheduleNextChannel();
        return;
      }
      const next = (this.currentIndex + 1) % Math.max(1, this.channels.length);
      const channel = this.channels[next];
      if (channel) void this.startChannel(channel, false).finally(() => this.scheduleNextChannel());
    }, this.request.dwellTime * 1_000);
  }

  private tick(): void {
    if (this.stopped) return;
    const active = hackrfService.getStatus().activeStream;
    this.telemetry = active?.id === this.streamId && active.phase === "running" ? active.telemetry : null;
    const feed = hackrfService.getSpectrumFeed();
    this.spectrum = feed.owner === "audio" ? feed.frame : null;
    if (this.pendingChannel && active?.phase === "running" && active.freqHz === Math.round(this.pendingChannel.freqMhz * 1_000_000)) {
      this.activeChannel = this.pendingChannel;
      this.pendingChannel = null;
      this.currentIndex = Math.max(0, this.channels.findIndex((item) => item.id === this.activeChannel?.id));
      this.state = "active";
    }
    this.publishSnapshot();
  }

  private toAnalysisResult(decode: import("@/lib/morse-decoder").MorseDecodeResult): MorseAnalysisResult {
    const now = Date.now();
    return {
      engine: "hackrf-webui-morse",
      engineVersion: "1",
      frontEnd: this.request.frontEnd,
      tunedFrequencyHz: this.activeChannel ? Math.round(this.activeChannel.freqMhz * 1_000_000) : null,
      detectedFrequencyHz: null,
      frequencyOffsetHz: null,
      toneHz: this.decode.toneHz,
      startedAtMs: new Date(this.createdAt).getTime(),
      endedAtMs: now,
      dotMs: decode.dotDurationMs,
      wordsPerMinute: decode.wordsPerMinute,
      snrDb: null,
      noiseFloorDb: null,
      rawMorse: decode.rawGroups.join(" "),
      decodedText: decode.text,
      characters: decode.characters.map((character) => ({
        text: character.text,
        raw: character.raw,
        confidence: character.confidence,
        startMs: 0,
        endMs: 0,
      })),
      confidence: decode.confidence,
      unresolvedCount: decode.characters.filter((character) => character.text === "?").length,
      expectedIdentifier: this.decode.expectedIdentifier,
      identifierMatch: this.decode.identifierMatch,
      catalog: this.activeChannel?.catalogSource ? {
        source: this.activeChannel.catalogSource,
        recordId: this.activeChannel.catalogRecordId ?? null,
        version: this.activeChannel.catalogVersion ?? null,
      } : null,
      evidence: { wav: null, iq: null },
    };
  }

  private async persistCompletedDecode(captureSessionId: string): Promise<void> {
    if (!this.pendingAnalysis || this.persistedCaptureIds.has(captureSessionId)) return;
    try {
      const now = Date.now();
      const result = await bindMorseResultToCaptureEvidence(captureSessionId, this.pendingAnalysis);
      const records = buildMorsePersistenceRecords({
        captureSessionId,
        analysisJobId: `morse-job-${captureSessionId}`,
        findingId: `morse-finding-${captureSessionId}`,
        transcriptId: `morse-transcript-${captureSessionId}`,
        tagId: (tag) => `morse-tag-${captureSessionId}-${tag.replace(/[^a-z0-9]+/gi, "-")}`,
        createdAtMs: now,
        result,
      });
      persistMorsePersistenceRecords(records);
      this.persistedCaptureIds.add(captureSessionId);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "MORSE evidence persistence failed.";
      this.message = "MORSE decode preserved in memory, but evidence persistence failed.";
      this.publishSnapshot();
    }
  }

  private readonly runtimeFactory = createMorseRuntime;
}
