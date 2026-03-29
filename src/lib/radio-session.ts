import type { ActivityLogEntry } from "@/lib/activity-events";
import type { AudioControls, RadioChannel } from "@/lib/radio";
import type {
  AdsbRuntimeStatus,
  AisRuntimeStatus,
  AudioDemodMode,
  FmStation,
  ResolvedAppLocation,
  SignalLevelTelemetry,
  SpectrumFrame,
} from "@/lib/types";

export type RadioSessionKind = "fm" | "narrowband" | "ais" | "adsb";
export type RadioSessionModule = "fm" | "pmr" | "airband" | "maritime" | "ais" | "adsb";
export type RadioSessionState =
  | "starting"
  | "tuning"
  | "settling"
  | "monitoring"
  | "active"
  | "locked"
  | "stopping"
  | "stopped"
  | "error";

export type NarrowbandSessionMode = "manual" | "scan";
export type NarrowbandScanMode = "sequential" | "random";

export type RadioSessionChannel = Pick<RadioChannel, "id" | "bandId" | "number" | "freqMhz" | "label" | "notes">;
export type RadioSessionFmStation = Pick<FmStation, "id" | "name" | "freqMhz">;

export function radioSessionChannelDeckSignature(channels: RadioSessionChannel[]): string {
  return channels
    .map((channel) => `${channel.id}:${channel.bandId}:${channel.number}:${channel.freqMhz.toFixed(6)}`)
    .join("|");
}

export type NarrowbandScannerSnapshot = {
  channelCount: number;
  currentIndex: number;
  lockedAt: string | null;
  lastActivityAt: string | null;
  settleUntil: string | null;
  dwellDeadlineAt: string | null;
};

type NarrowbandSessionSnapshotBase = {
  id: string;
  kind: "narrowband";
  mode: NarrowbandSessionMode;
  state: RadioSessionState;
  startedAt: string;
  updatedAt: string;
  controls: AudioControls;
  squelch: number;
  dwellTime: number;
  holdTime: number;
  scanMode: NarrowbandScanMode;
  bandId: string;
  channelDeckSignature: string;
  activeChannel: RadioSessionChannel | null;
  pendingChannel: RadioSessionChannel | null;
  streamId: string | null;
  telemetry: SignalLevelTelemetry | null;
  spectrum: SpectrumFrame | null;
  currentActivityEventId: string | null;
  currentBurstEventId: string | null;
  recentActivity: ActivityLogEntry[];
  scanner: NarrowbandScannerSnapshot;
  audioAvailable: boolean;
  message: string;
  lastError: string | null;
};

export type PmrSessionSnapshot = NarrowbandSessionSnapshotBase & { module: "pmr" };
export type AirbandSessionSnapshot = NarrowbandSessionSnapshotBase & { module: "airband" };
export type MaritimeSessionSnapshot = NarrowbandSessionSnapshotBase & { module: "maritime" };
export type NarrowbandSessionSnapshot = PmrSessionSnapshot | AirbandSessionSnapshot | MaritimeSessionSnapshot;

export type FmSessionSnapshot = {
  id: string;
  kind: "fm";
  module: "fm";
  state: RadioSessionState;
  startedAt: string;
  updatedAt: string;
  controls: AudioControls;
  activeStation: RadioSessionFmStation | null;
  pendingStation: RadioSessionFmStation | null;
  streamId: string | null;
  telemetry: SignalLevelTelemetry | null;
  spectrum: SpectrumFrame | null;
  audioAvailable: boolean;
  message: string;
  lastError: string | null;
};

export type AisSessionSnapshot = {
  id: string;
  kind: "ais";
  module: "ais";
  state: RadioSessionState;
  startedAt: string;
  updatedAt: string;
  runtime: AisRuntimeStatus;
  vesselCount: number;
  movingCount: number;
  latestPositionAt: string | null;
  audioAvailable: false;
  message: string;
  lastError: string | null;
};

export type AdsbSessionSnapshot = {
  id: string;
  kind: "adsb";
  module: "adsb";
  state: RadioSessionState;
  startedAt: string;
  updatedAt: string;
  runtime: AdsbRuntimeStatus;
  aircraftCount: number;
  positionCount: number;
  latestMessageAt: string | null;
  audioAvailable: false;
  message: string;
  lastError: string | null;
};

export type RadioSessionSnapshot = FmSessionSnapshot | NarrowbandSessionSnapshot | AisSessionSnapshot | AdsbSessionSnapshot;
export type RadioSessionSnapshotForModule<M extends RadioSessionModule> = Extract<RadioSessionSnapshot, { module: M }>;

type CreateNarrowbandSessionRequestBase = {
  kind: "narrowband";
  mode: NarrowbandSessionMode;
  controls: AudioControls;
  bandId: string;
  channels: RadioSessionChannel[];
  scanMode?: NarrowbandScanMode;
  manualChannelId?: string | null;
  squelch: number;
  dwellTime: number;
  holdTime: number;
  location?: ResolvedAppLocation | null;
};

export type CreatePmrSessionRequest = CreateNarrowbandSessionRequestBase & { module: "pmr" };
export type CreateAirbandSessionRequest = CreateNarrowbandSessionRequestBase & { module: "airband" };
export type CreateMaritimeSessionRequest = CreateNarrowbandSessionRequestBase & { module: "maritime" };
export type CreateNarrowbandSessionRequest =
  | CreatePmrSessionRequest
  | CreateAirbandSessionRequest
  | CreateMaritimeSessionRequest;

export type CreateFmSessionRequest = {
  kind: "fm";
  module: "fm";
  controls: AudioControls;
  station: RadioSessionFmStation;
};

export type CreateAisSessionRequest = {
  kind: "ais";
  module: "ais";
};

export type CreateAdsbSessionRequest = {
  kind: "adsb";
  module: "adsb";
};

export type CreateRadioSessionRequest =
  | CreateFmSessionRequest
  | CreateNarrowbandSessionRequest
  | CreateAisSessionRequest
  | CreateAdsbSessionRequest;
export type CreateRadioSessionRequestForModule<M extends RadioSessionModule> = Extract<CreateRadioSessionRequest, { module: M }>;

export type UpdateNarrowbandSessionRequest = {
  mode?: NarrowbandSessionMode;
  controls?: AudioControls;
  bandId?: string;
  channels?: RadioSessionChannel[];
  scanMode?: NarrowbandScanMode;
  manualChannelId?: string | null;
  squelch?: number;
  dwellTime?: number;
  holdTime?: number;
  location?: ResolvedAppLocation | null;
};

export type UpdateFmSessionRequest = {
  controls?: AudioControls;
  station?: RadioSessionFmStation;
};

export type NarrowbandModuleConfig = {
  module: Extract<RadioSessionModule, "pmr" | "airband" | "maritime">;
  demodMode: AudioDemodMode;
  label: string;
};

export type UpdateRadioSessionRequest = UpdateFmSessionRequest | UpdateNarrowbandSessionRequest;
export type UpdateRadioSessionRequestForModule<M extends RadioSessionModule> =
  M extends "fm"
    ? UpdateFmSessionRequest
    : M extends "pmr" | "airband" | "maritime"
      ? UpdateNarrowbandSessionRequest
      : never;

export type RadioSessionEvent =
  | {
    type: "snapshot";
    sessionId: string;
    snapshot: RadioSessionSnapshot;
  }
  | {
    type: "activity";
    sessionId: string;
    entry: ActivityLogEntry;
    snapshot: RadioSessionSnapshot;
  }
  | {
    type: "session-error";
    sessionId: string;
    message: string;
    snapshot: RadioSessionSnapshot;
  };
