import { randomUUID } from "node:crypto";

import type { AdsbFeedSnapshot } from "@/lib/types";
import type { AdsbSessionSnapshot, RadioSessionSnapshot, UpdateRadioSessionRequest } from "@/lib/radio-session";
import { adsbService } from "@/server/adsb";
import type { RadioEventBus } from "@/server/radio/event-bus";
import type { RadioSessionStore } from "@/server/radio/session-store";

function nowIso(): string {
  return new Date().toISOString();
}

function mapRuntimeState(state: AdsbFeedSnapshot["runtime"]["state"]): AdsbSessionSnapshot["state"] {
  switch (state) {
    case "starting":
      return "starting";
    case "running":
      return "active";
    case "error":
      return "error";
    case "stopped":
    default:
      return "stopped";
  }
}

export class AdsbSession {
  readonly id = `adsb-${randomUUID()}`;

  private readonly createdAt = nowIso();

  private updatedAt = this.createdAt;

  private snapshot: AdsbSessionSnapshot = this.buildSnapshot(adsbService.getSnapshot());

  private timer: ReturnType<typeof setInterval> | null = null;

  private stopped = false;

  constructor(
    private readonly store: RadioSessionStore,
    private readonly events: RadioEventBus,
  ) {}

  private buildSnapshot(feed: AdsbFeedSnapshot): AdsbSessionSnapshot {
    this.updatedAt = nowIso();
    return {
      id: this.id,
      kind: "adsb",
      module: "adsb",
      state: mapRuntimeState(feed.runtime.state),
      startedAt: feed.runtime.startedAt ?? this.createdAt,
      updatedAt: this.updatedAt,
      runtime: feed.runtime,
      aircraftCount: feed.aircraftCount,
      positionCount: feed.positionCount,
      latestMessageAt: feed.latestMessageAt,
      audioAvailable: false,
      message: feed.runtime.message,
      lastError: feed.runtime.state === "error" ? feed.runtime.message : null,
    };
  }

  private publish(feed: AdsbFeedSnapshot): void {
    this.snapshot = this.buildSnapshot(feed);
    this.store.set(this.snapshot);
    this.events.publish({
      type: "snapshot",
      sessionId: this.id,
      snapshot: this.snapshot,
    });
  }

  private refresh(): void {
    if (this.stopped) {
      return;
    }
    this.publish(adsbService.getSnapshot());
  }

  private ensureMirrorLoop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = setInterval(() => this.refresh(), 1000);
  }

  async start(): Promise<void> {
    this.stopped = false;
    await adsbService.start();
    this.publish(adsbService.getSnapshot());
    this.ensureMirrorLoop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await adsbService.stop();
  }

  async update(patch: UpdateRadioSessionRequest): Promise<RadioSessionSnapshot> {
    void patch;
    throw new Error("ADS-B sessions do not support live PATCH updates yet.");
  }

  getSnapshot(): RadioSessionSnapshot {
    return this.snapshot;
  }

  createAudioStream(): ReadableStream<Uint8Array> {
    throw new Error("ADS-B sessions do not expose a live audio stream.");
  }
}
