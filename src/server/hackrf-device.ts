export type HackrfOwnerId = "audio" | "ais" | "adsb";

export type HackrfOwnerState = {
  id: HackrfOwnerId;
  label: string;
  startedAt: string;
};

class HackrfDeviceService {
  private owner: HackrfOwnerState | null = null;

  claim(id: HackrfOwnerId, label: string): void {
    if (this.owner && this.owner.id !== id) {
      throw new Error(`HackRF is already in use by ${this.owner.label}.`);
    }

    if (!this.owner) {
      this.owner = {
        id,
        label,
        startedAt: new Date().toISOString(),
      };
      return;
    }

    this.owner = {
      ...this.owner,
      label,
    };
  }

  release(id: HackrfOwnerId): void {
    if (this.owner?.id === id) {
      this.owner = null;
    }
  }

  getOwner(): HackrfOwnerState | null {
    return this.owner ? { ...this.owner } : null;
  }
}

declare global {
  var __hackrfWebUiDeviceService: HackrfDeviceService | undefined;
}

export const hackrfDeviceService =
  global.__hackrfWebUiDeviceService ?? new HackrfDeviceService();

if (process.env.NODE_ENV !== "production") {
  global.__hackrfWebUiDeviceService = hackrfDeviceService;
}
