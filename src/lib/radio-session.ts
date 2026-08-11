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

export type RadioSessionKind = "fm" | "narrowband" | "morse" | "ais" | "adsb";
export type RadioSessionModule = "fm" | "pmr" | "airband" | "maritime" | "morse" | "ais" | "adsb";
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
export type MorseFrontEnd = "cw_carrier" | "am_tone";

export type RadioSessionChannel = Pick<RadioChannel, "id" | "bandId" | "number" | "freqMhz" | "label" | "notes"> & {
  expectedIdentifier?: string | null;
  catalogSource?: string | null;
  catalogRecordId?: string | null;
  catalogVersion?: string | null;
};
export type RadioSessionFmStation = Pick<FmStation, "id" | "name" | "freqMhz">;

export function radioSessionChannelDeckSignature(channels: RadioSessionChannel[]): string {
  return channels
    .map((channel) => `${channel.id}:${channel.bandId}:${channel.number}:${channel.freqMhz.toFixed(6)}:${channel.expectedIdentifier ?? ""}`)
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

export type MorseDecodeSnapshot = {
  text: string;
  rawMorse: string;
  confidence: number;
  dotMs: number | null;
  wordsPerMinute: number | null;
  toneHz: number | null;
  holdState: "SCANNING" | "CANDIDATE" | "HOLD" | "DECODING" | "POST_HOLD";
  expectedIdentifier: string | null;
  identifierMatch: boolean | null;
};

export type MorseSessionSnapshot = {
  id: string;
  kind: "morse";
  module: "morse";
  state: RadioSessionState;
  mode: NarrowbandSessionMode;
  frontEnd: MorseFrontEnd;
  startedAt: string;
  updatedAt: string;
  controls: AudioControls;
  bandId: string;
  channels: RadioSessionChannel[];
  scanMode: NarrowbandScanMode;
  manualChannelId: string | null;
  squelch: number;
  dwellTime: number;
  holdTime: number;
  location: ResolvedAppLocation | null;
  activeChannel: RadioSessionChannel | null;
  pendingChannel: RadioSessionChannel | null;
  streamId: string | null;
  scanner: {
    channelCount: number;
    currentIndex: number | null;
    holdState: MorseDecodeSnapshot["holdState"];
  };
  telemetry: SignalLevelTelemetry | null;
  spectrum: SpectrumFrame | null;
  audioAvailable: boolean;
  message: string;
  lastError: string | null;
  decode: MorseDecodeSnapshot;
};

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

export type RadioSessionSnapshot = FmSessionSnapshot | NarrowbandSessionSnapshot | MorseSessionSnapshot | AisSessionSnapshot | AdsbSessionSnapshot;
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

export type CreateMorseSessionRequest = Omit<CreateNarrowbandSessionRequestBase, "kind"> & {
  kind: "morse";
  module: "morse";
  frontEnd: MorseFrontEnd;
};

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
  | CreateMorseSessionRequest
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

export type UpdateMorseSessionRequest = UpdateNarrowbandSessionRequest & {
  frontEnd?: MorseFrontEnd;
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

export type UpdateRadioSessionRequest = UpdateFmSessionRequest | UpdateNarrowbandSessionRequest | UpdateMorseSessionRequest;
export type UpdateRadioSessionRequestForModule<M extends RadioSessionModule> =
  M extends "fm"
    ? UpdateFmSessionRequest
    : M extends "pmr" | "airband" | "maritime"
      ? UpdateNarrowbandSessionRequest
      : M extends "morse"
        ? UpdateMorseSessionRequest
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
