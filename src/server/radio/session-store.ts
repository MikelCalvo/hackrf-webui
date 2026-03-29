import type { RadioSessionSnapshot } from "@/lib/radio-session";

export class RadioSessionStore {
  private readonly snapshots = new Map<string, RadioSessionSnapshot>();

  list(): RadioSessionSnapshot[] {
    return [...this.snapshots.values()];
  }

  get(sessionId: string): RadioSessionSnapshot | null {
    return this.snapshots.get(sessionId) ?? null;
  }

  set(snapshot: RadioSessionSnapshot): void {
    this.snapshots.set(snapshot.id, snapshot);
  }

  delete(sessionId: string): void {
    this.snapshots.delete(sessionId);
  }
}
