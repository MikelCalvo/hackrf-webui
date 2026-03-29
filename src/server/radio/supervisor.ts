import type {
  CreateRadioSessionRequest,
  RadioSessionEvent,
  RadioSessionModule,
  RadioSessionSnapshot,
  UpdateRadioSessionRequest,
} from "@/lib/radio-session";
import { AdsbSession } from "@/server/radio/adsb-session";
import { AisSession } from "@/server/radio/ais-session";
import { RadioEventBus } from "@/server/radio/event-bus";
import { FmSession } from "@/server/radio/fm-session";
import { NarrowbandSession } from "@/server/radio/narrowband-session";
import { RadioScheduler } from "@/server/radio/scheduler";
import { RadioSessionStore } from "@/server/radio/session-store";

type ManagedSession = {
  id: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  update: (patch: UpdateRadioSessionRequest) => Promise<RadioSessionSnapshot>;
  getSnapshot: () => RadioSessionSnapshot;
  createAudioStream: () => ReadableStream<Uint8Array>;
};

class RadioSupervisor {
  private readonly sessions = new Map<string, ManagedSession>();

  private readonly store = new RadioSessionStore();

  private readonly events = new RadioEventBus();

  private readonly scheduler = new RadioScheduler();

  private createdCount = 0;

  private stoppedCount = 0;

  private failedCreateCount = 0;

  private failedStopCount = 0;

  async createSession(request: CreateRadioSessionRequest): Promise<RadioSessionSnapshot> {
    await this.stopAllSessions();
    const session =
      request.kind === "fm"
        ? new FmSession(request, this.store, this.events)
        : request.kind === "narrowband"
        ? new NarrowbandSession(request, this.store, this.events)
        : request.kind === "ais"
          ? new AisSession(this.store, this.events)
          : request.kind === "adsb"
            ? new AdsbSession(this.store, this.events)
            : null;
    if (!session) {
      throw new Error("Unsupported radio session kind.");
    }

    if (!this.scheduler.acquire(session.id)) {
      throw new Error("HackRF is already reserved by another server-side radio session.");
    }

    this.sessions.set(session.id, session);
    try {
      await session.start();
      this.createdCount += 1;
      return session.getSnapshot();
    } catch (error) {
      this.sessions.delete(session.id);
      this.scheduler.release(session.id);
      this.store.delete(session.id);
      this.failedCreateCount += 1;
      throw error;
    }
  }

  listSessions(): RadioSessionSnapshot[] {
    return this.store.list();
  }

  getSession(sessionId: string): RadioSessionSnapshot | null {
    return this.store.get(sessionId);
  }

  getManagedSession(sessionId: string): ManagedSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  findSessionByModule(module: RadioSessionModule): RadioSessionSnapshot | null {
    return this.store.list().find((session) => session.module === module) ?? null;
  }

  getManagedSessionByModule(module: RadioSessionModule): ManagedSession | null {
    const snapshot = this.findSessionByModule(module);
    return snapshot ? this.getManagedSession(snapshot.id) : null;
  }

  async updateSession(sessionId: string, patch: UpdateRadioSessionRequest): Promise<RadioSessionSnapshot | null> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    return session.update(patch);
  }

  subscribe(sessionId: string, listener: (event: RadioSessionEvent) => void): () => void {
    return this.events.subscribe(sessionId, listener);
  }

  async stopSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    this.sessions.delete(sessionId);
    this.scheduler.release(sessionId);
    try {
      await session.stop();
      this.stoppedCount += 1;
    } catch (error) {
      this.failedStopCount += 1;
      throw error;
    } finally {
      this.store.delete(sessionId);
    }
    return true;
  }

  async stopSessionByModule(module: RadioSessionModule): Promise<boolean> {
    const snapshot = this.findSessionByModule(module);
    if (!snapshot) {
      return false;
    }
    return this.stopSession(snapshot.id);
  }

  async stopAllSessions(): Promise<void> {
    const sessionIds = [...this.sessions.keys()];
    for (const sessionId of sessionIds) {
      await this.stopSession(sessionId);
    }
  }

  getDebugSnapshot(): {
    sessions: RadioSessionSnapshot[];
    scheduler: ReturnType<RadioScheduler["getDebugState"]>;
    recentSessionEvents: ReturnType<RadioEventBus["listRecent"]>;
    listeners: ReturnType<RadioEventBus["getListenerCounts"]>;
    stats: {
      createdCount: number;
      stoppedCount: number;
      failedCreateCount: number;
      failedStopCount: number;
      liveSessionCount: number;
    };
  } {
    return {
      sessions: this.listSessions(),
      scheduler: this.scheduler.getDebugState(),
      recentSessionEvents: this.events.listRecent(),
      listeners: this.events.getListenerCounts(),
      stats: {
        createdCount: this.createdCount,
        stoppedCount: this.stoppedCount,
        failedCreateCount: this.failedCreateCount,
        failedStopCount: this.failedStopCount,
        liveSessionCount: this.sessions.size,
      },
    };
  }
}

export const radioSupervisor = new RadioSupervisor();
