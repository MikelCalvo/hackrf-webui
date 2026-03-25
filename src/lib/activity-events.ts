import type { AudioDemodMode, ResolvedAppLocation } from "@/lib/types";

export type ActivityEventModule = "pmr" | "airband" | "maritime";
export type ActivityEventMode = "manual" | "scan";
export const ACTIVITY_EVENTS_DEFAULT_LIMIT = 100;

export type ActivityCaptureStatus = "none" | "saved";

export type ActivityCaptureFileSummary = {
  id: string;
  kind: "audio" | "raw_iq";
  format: string;
  relativePath: string;
  url: string;
};

export type ActivityLogEntry = {
  id: string;
  module: ActivityEventModule;
  mode: ActivityEventMode;
  label: string;
  freqMhz: number;
  rms: number;
  time: string;
  occurredAt: string;
  bandId: string | null;
  channelId: string | null;
  channelNumber: number | null;
  captureStatus: ActivityCaptureStatus;
  captureSessionId: string | null;
  audioCapture: ActivityCaptureFileSummary | null;
  rawIqCapture: ActivityCaptureFileSummary | null;
};

export type CreateActivityEventInput = {
  module: ActivityEventModule;
  mode: ActivityEventMode;
  label: string;
  freqMhz: number;
  rms: number;
  occurredAt: string;
  bandId?: string | null;
  channelId?: string | null;
  channelNumber?: number | null;
  demodMode?: AudioDemodMode | null;
  squelch?: number | null;
  location?: ResolvedAppLocation | null;
  metadata?: Record<string, unknown> | null;
};

type ActivityEventsListResponse = {
  events: ActivityLogEntry[];
};

export function formatActivityEventDisplayTime(value: string): string {
  const parsed = Date.parse(value);
  const safeValue = Number.isFinite(parsed) ? parsed : Date.now();
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(safeValue));
}

export function createActivityLogEntryFallback(
  input: CreateActivityEventInput,
): ActivityLogEntry {
  return {
    id: `local-${input.module}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    module: input.module,
    mode: input.mode,
    label: input.label,
    freqMhz: input.freqMhz,
    rms: input.rms,
    time: formatActivityEventDisplayTime(input.occurredAt),
    occurredAt: input.occurredAt,
    bandId: input.bandId ?? null,
    channelId: input.channelId ?? null,
    channelNumber: input.channelNumber ?? null,
    captureStatus: "none",
    captureSessionId: null,
    audioCapture: null,
    rawIqCapture: null,
  };
}

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

export async function fetchActivityEvents(
  module: ActivityEventModule,
  limit = ACTIVITY_EVENTS_DEFAULT_LIMIT,
): Promise<ActivityLogEntry[]> {
  const response = await fetch(
    `/api/activity-events?module=${encodeURIComponent(module)}&limit=${encodeURIComponent(String(limit))}`,
    { cache: "no-store" },
  );
  const payload = (await ensureOk(response).then((res) => res.json())) as ActivityEventsListResponse;
  return payload.events;
}

export async function persistActivityEvent(
  input: CreateActivityEventInput,
): Promise<ActivityLogEntry> {
  const response = await fetch("/api/activity-events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  return ensureOk(response).then((res) => res.json()) as Promise<ActivityLogEntry>;
}

export async function clearActivityEvents(module: ActivityEventModule): Promise<void> {
  const response = await fetch(`/api/activity-events?module=${encodeURIComponent(module)}`, {
    method: "DELETE",
  });
  await ensureOk(response);
}
