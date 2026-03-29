import type { RadioSessionEvent } from "@/lib/radio-session";

type SessionListener = (event: RadioSessionEvent) => void;
type RecordedRadioSessionEvent = {
  at: string;
  event: RadioSessionEvent;
};

const MAX_RECORDED_EVENTS = 250;

export class RadioEventBus {
  private readonly listeners = new Map<string, Set<SessionListener>>();

  private readonly recentEvents: RecordedRadioSessionEvent[] = [];

  subscribe(sessionId: string, listener: SessionListener): () => void {
    const set = this.listeners.get(sessionId) ?? new Set<SessionListener>();
    set.add(listener);
    this.listeners.set(sessionId, set);

    return () => {
      const current = this.listeners.get(sessionId);
      if (!current) {
        return;
      }
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  publish(event: RadioSessionEvent): void {
    this.recentEvents.push({
      at: new Date().toISOString(),
      event,
    });
    if (this.recentEvents.length > MAX_RECORDED_EVENTS) {
      this.recentEvents.splice(0, this.recentEvents.length - MAX_RECORDED_EVENTS);
    }

    const set = this.listeners.get(event.sessionId);
    if (!set || set.size === 0) {
      return;
    }

    for (const listener of [...set]) {
      try {
        listener(event);
      } catch (error) {
        console.error("[radio] Event listener failed:", error);
      }
    }
  }

  listRecent(sessionId?: string): RecordedRadioSessionEvent[] {
    if (!sessionId) {
      return [...this.recentEvents];
    }
    return this.recentEvents.filter((entry) => entry.event.sessionId === sessionId);
  }

  getListenerCounts(): Array<{ sessionId: string; listeners: number }> {
    return [...this.listeners.entries()].map(([sessionId, listeners]) => ({
      sessionId,
      listeners: listeners.size,
    }));
  }
}
