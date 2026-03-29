import { randomUUID } from "node:crypto";

import type { AisFeedSnapshot } from "@/lib/types";
import type { AisSessionSnapshot, RadioSessionSnapshot, UpdateRadioSessionRequest } from "@/lib/radio-session";
import { aisService } from "@/server/ais";
import type { RadioEventBus } from "@/server/radio/event-bus";
import type { RadioSessionStore } from "@/server/radio/session-store";

function nowIso(): string {
  return new Date().toISOString();
}

function mapRuntimeState(state: AisFeedSnapshot["runtime"]["state"]): AisSessionSnapshot["state"] {
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

export class AisSession {
  readonly id = `ais-${randomUUID()}`;

  private readonly createdAt = nowIso();

  private updatedAt = this.createdAt;

  private snapshot: AisSessionSnapshot = this.buildSnapshot(aisService.getSnapshot());

  private timer: ReturnType<typeof setInterval> | null = null;

  private stopped = false;

  constructor(
    private readonly store: RadioSessionStore,
    private readonly events: RadioEventBus,
  ) {}

  private buildSnapshot(feed: AisFeedSnapshot): AisSessionSnapshot {
    this.updatedAt = nowIso();
    return {
      id: this.id,
      kind: "ais",
      module: "ais",
      state: mapRuntimeState(feed.runtime.state),
      startedAt: feed.runtime.startedAt ?? this.createdAt,
      updatedAt: this.updatedAt,
      runtime: feed.runtime,
      vesselCount: feed.vesselCount,
      movingCount: feed.movingCount,
      latestPositionAt: feed.latestPositionAt,
      audioAvailable: false,
      message: feed.runtime.message,
      lastError: feed.runtime.state === "error" ? feed.runtime.message : null,
    };
  }

  private publish(feed: AisFeedSnapshot): void {
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
    this.publish(aisService.getSnapshot());
  }

  private ensureMirrorLoop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = setInterval(() => this.refresh(), 1000);
  }

  async start(): Promise<void> {
    this.stopped = false;
    await aisService.start();
    this.publish(aisService.getSnapshot());
    this.ensureMirrorLoop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await aisService.stop();
  }

  async update(patch: UpdateRadioSessionRequest): Promise<RadioSessionSnapshot> {
    void patch;
    throw new Error("AIS sessions do not support live PATCH updates yet.");
  }

  getSnapshot(): RadioSessionSnapshot {
    return this.snapshot;
  }

  createAudioStream(): ReadableStream<Uint8Array> {
    throw new Error("AIS sessions do not expose a live audio stream.");
  }
}
