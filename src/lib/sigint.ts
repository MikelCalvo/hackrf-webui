import type {
  AdsbTrackHistoryResponse,
  AisTrackHistoryResponse,
  AudioCaptureModule,
  AudioDemodMode,
} from "@/lib/types";

export type SigintReviewStatus = "pending" | "kept" | "discarded" | "flagged";
export type SigintReviewPriority = "normal" | "high";
export type SigintCaptureTab = "captures" | "adsb" | "ais";
export type SigintTrackKind = "adsb" | "ais";
export type SigintAnalysisStatus = "none" | "queued" | "running" | "completed" | "failed";
export type SigintAnalysisFilter =
  | "all"
  | "speech"
  | "music"
  | "noise"
  | "unknown"
  | "queued"
  | "running"
  | "failed";

export type SigintAnalysisSummary = {
  status: SigintAnalysisStatus;
  engine: string | null;
  isCurrentEngine: boolean | null;
  model: string | null;
  classification: "speech" | "music" | "noise" | "unknown" | null;
  subclass: string | null;
  confidence: number | null;
  errorText: string | null;
  updatedAt: string | null;
  audioSeconds: number | null;
  rms: number | null;
  sceneLabel: string | null;
  sceneConfidence: number | null;
  voiceDetected: boolean | null;
  voiceConfidence: number | null;
  voiceRatio: number | null;
  voiceSeconds: number | null;
  voiceDetector: string | null;
  explanation: string | null;
  topLabels: Array<{
    label: string;
    score: number;
  }>;
};

export type SigintCaptureFile = {
  id: string;
  kind: "audio" | "raw_iq";
  format: string;
  relativePath: string;
  url: string;
};

export type SigintCaptureSummary = {
  id: string;
  activityEventId: string | null;
  burstEventId: string | null;
  module: AudioCaptureModule;
  mode: "manual" | "scan";
  reason: string;
  label: string;
  freqMhz: number | null;
  demodMode: AudioDemodMode | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  reviewStatus: SigintReviewStatus;
  reviewPriority: SigintReviewPriority;
  reviewNotes: string;
  reviewedAt: string | null;
  locationLabel: string;
  locationSource: string | null;
  locationSourceDetail: string | null;
  cityName: string | null;
  countryName: string | null;
  countryCode: string | null;
  resolvedLatitude: number | null;
  resolvedLongitude: number | null;
  deviceLabel: string | null;
  deviceSerial: string | null;
  rmsAvg: number | null;
  rmsPeak: number | null;
  rfPeak: number | null;
  squelch: number | null;
  lna: number | null;
  vga: number | null;
  audioGain: number | null;
  audioCapture: SigintCaptureFile | null;
  rawIqCapture: SigintCaptureFile | null;
  tagCount: number;
  transcriptCount: number;
  analysisJobCount: number;
  analysisSummary: SigintAnalysisSummary;
};

export type SigintCaptureDetail = SigintCaptureSummary & {
  metadata: Record<string, unknown> | null;
  location: Record<string, unknown> | null;
  tags: Array<{
    id: string;
    tag: string;
    source: string;
    score: number | null;
    createdAt: string;
  }>;
  transcripts: Array<{
    id: string;
    engine: string;
    language: string | null;
    text: string;
    createdAt: string;
  }>;
  analysisJobs: Array<{
    id: string;
    burstEventId: string | null;
    engine: string;
    status: string;
    errorText: string | null;
    createdAt: string;
    startedAt: string | null;
    endedAt: string | null;
  }>;
};

export type SigintCaptureListResponse = {
  items: SigintCaptureSummary[];
  counts: {
    total: number;
    pending: number;
    kept: number;
    discarded: number;
    flagged: number;
    withAudio: number;
    withRawIq: number;
  };
};

export type SigintCaptureListFilters = {
  module: "all" | AudioCaptureModule;
  reviewStatus: "all" | SigintReviewStatus;
  analysis: SigintAnalysisFilter;
  hasAudio: boolean;
  hasRawIq: boolean;
  q: string;
  limit: number;
};

export type SigintReviewUpdateInput = {
  status: SigintReviewStatus;
  priority: SigintReviewPriority;
  notes: string;
};

export type SigintTrackSummary = {
  kind: SigintTrackKind;
  key: string;
  label: string;
  secondaryLabel: string;
  sourceLabel: string;
  pointCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type SigintTrackSummaryResponse = {
  kind: SigintTrackKind;
  items: SigintTrackSummary[];
};

function ensureOk(response: Response): Promise<Response> {
  if (response.ok) {
    return Promise.resolve(response);
  }

  return response
    .json()
    .catch(() => null)
    .then((payload) => {
      const message =
        payload && typeof payload === "object" && "message" in payload
          ? String((payload as { message?: unknown }).message ?? "")
          : "";
      throw new Error(message || `HTTP ${response.status}`);
    });
}

export async function fetchSigintCaptures(
  filters: Partial<SigintCaptureListFilters> = {},
): Promise<SigintCaptureListResponse> {
  const params = new URLSearchParams();
  if (filters.module && filters.module !== "all") {
    params.set("module", filters.module);
  }
  if (filters.reviewStatus && filters.reviewStatus !== "all") {
    params.set("reviewStatus", filters.reviewStatus);
  }
  if (filters.analysis && filters.analysis !== "all") {
    params.set("analysis", filters.analysis);
  }
  if (filters.hasAudio) {
    params.set("hasAudio", "1");
  }
  if (filters.hasRawIq) {
    params.set("hasRawIq", "1");
  }
  if (filters.q) {
    params.set("q", filters.q);
  }
  if (filters.limit) {
    params.set("limit", String(filters.limit));
  }

  const response = await fetch(`/api/sigint/captures?${params.toString()}`, {
    cache: "no-store",
  });
  return ensureOk(response).then((res) => res.json()) as Promise<SigintCaptureListResponse>;
}

export async function fetchSigintCaptureDetail(captureSessionId: string): Promise<SigintCaptureDetail> {
  const response = await fetch(`/api/sigint/captures/${encodeURIComponent(captureSessionId)}`, {
    cache: "no-store",
  });
  return ensureOk(response).then((res) => res.json()) as Promise<SigintCaptureDetail>;
}

export async function updateSigintCaptureReview(
  captureSessionId: string,
  input: SigintReviewUpdateInput,
): Promise<SigintCaptureDetail> {
  const response = await fetch(`/api/sigint/captures/${encodeURIComponent(captureSessionId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return ensureOk(response).then((res) => res.json()) as Promise<SigintCaptureDetail>;
}

export async function fetchSigintTrackSummaries(
  kind: SigintTrackKind,
  limit = 100,
): Promise<SigintTrackSummaryResponse> {
  const response = await fetch(
    `/api/sigint/routes?kind=${encodeURIComponent(kind)}&limit=${encodeURIComponent(String(limit))}`,
    { cache: "no-store" },
  );
  return ensureOk(response).then((res) => res.json()) as Promise<SigintTrackSummaryResponse>;
}

export async function fetchSigintTrackHistory(
  kind: SigintTrackKind,
  key: string,
): Promise<AdsbTrackHistoryResponse | AisTrackHistoryResponse> {
  const params =
    kind === "adsb"
      ? `hex=${encodeURIComponent(key)}`
      : `mmsi=${encodeURIComponent(key)}`;
  const endpoint = kind === "adsb" ? "/api/adsb/history" : "/api/ais/history";
  const response = await fetch(`${endpoint}?${params}`, { cache: "no-store" });
  return ensureOk(response).then((res) => res.json()) as Promise<
    AdsbTrackHistoryResponse | AisTrackHistoryResponse
  >;
}
