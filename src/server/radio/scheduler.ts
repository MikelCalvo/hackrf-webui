export class RadioScheduler {
  private ownerSessionId: string | null = null;

  private acquireAttempts = 0;

  private acquireDenied = 0;

  private releaseCount = 0;

  private readonly recentEvents: Array<{
    at: string;
    action: "acquire" | "release";
    sessionId: string;
    ownerSessionId: string | null;
    granted?: boolean;
  }> = [];

  private record(
    event: {
      action: "acquire" | "release";
      sessionId: string;
      ownerSessionId: string | null;
      granted?: boolean;
    },
  ): void {
    this.recentEvents.push({
      at: new Date().toISOString(),
      ...event,
    });
    if (this.recentEvents.length > 100) {
      this.recentEvents.splice(0, this.recentEvents.length - 100);
    }
  }

  canAcquire(sessionId: string): boolean {
    return this.ownerSessionId === null || this.ownerSessionId === sessionId;
  }

  acquire(sessionId: string): boolean {
    this.acquireAttempts += 1;
    const granted = this.canAcquire(sessionId);
    if (!granted) {
      this.acquireDenied += 1;
      this.record({
        action: "acquire",
        sessionId,
        ownerSessionId: this.ownerSessionId,
        granted: false,
      });
      return false;
    }
    this.ownerSessionId = sessionId;
    this.record({
      action: "acquire",
      sessionId,
      ownerSessionId: this.ownerSessionId,
      granted: true,
    });
    return true;
  }

  release(sessionId: string): void {
    if (this.ownerSessionId === sessionId) {
      this.releaseCount += 1;
      this.ownerSessionId = null;
      this.record({
        action: "release",
        sessionId,
        ownerSessionId: this.ownerSessionId,
      });
    }
  }

  getOwnerSessionId(): string | null {
    return this.ownerSessionId;
  }

  getDebugState(): {
    ownerSessionId: string | null;
    acquireAttempts: number;
    acquireDenied: number;
    releaseCount: number;
    recentEvents: Array<{
      at: string;
      action: "acquire" | "release";
      sessionId: string;
      ownerSessionId: string | null;
      granted?: boolean;
    }>;
  } {
    return {
      ownerSessionId: this.ownerSessionId,
      acquireAttempts: this.acquireAttempts,
      acquireDenied: this.acquireDenied,
      releaseCount: this.releaseCount,
      recentEvents: [...this.recentEvents],
    };
  }
}
