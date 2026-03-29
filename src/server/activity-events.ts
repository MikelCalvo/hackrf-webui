import { randomUUID } from "node:crypto";
import { rmSync, statSync } from "node:fs";

import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";

import type {
  ActivityCaptureFileSummary,
  ActivityEventModule,
  ActivityLogEntry,
  CreateActivityEventInput,
} from "@/lib/activity-events";
import type { AudioDemodMode } from "@/lib/types";
import { queueCaptureAnalysisJob } from "@/server/analysis-worker";
import { appDb } from "@/server/db/client";
import { activityEvents, burstEvents, captureFiles, captureSessions } from "@/server/db/schema";
import { captureAbsolutePath, capturePathExists, captureRelativePath } from "@/server/storage";

const CAPTURE_MATCH_LOOKBACK_MS = 8_000;
const CAPTURE_MATCH_LOOKAHEAD_MS = 2_000;

type CaptureFinalizeInput = {
  module: ActivityEventModule;
  mode: ActivityLogEntry["mode"];
  activityEventId?: string | null;
  burstEventId?: string | null;
  label: string;
  freqHz: number;
  demodMode: AudioDemodMode;
  bandId?: string | null;
  channelId?: string | null;
  channelNumber?: number | null;
  startedAtMs: number;
  endedAtMs: number;
  rmsAvg?: number | null;
  rmsPeak?: number | null;
  rfPeak?: number | null;
  squelch?: number | null;
  deviceLabel?: string | null;
  deviceSerial?: string | null;
  location?: Record<string, unknown> | null;
  audioAbsolutePath?: string | null;
  iqAbsolutePath?: string | null;
  metadata?: Record<string, unknown> | null;
};

function formatDisplayTime(timestampMs: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestampMs));
}

function safeJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function metadataStringValue(value: Record<string, unknown> | null, key: string): string | null {
  const raw = value?.[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

function locationString(
  input: CaptureFinalizeInput["location"],
  key: "regionId" | "countryId" | "cityId",
): string | null {
  if (!input || typeof input.catalogScope !== "object" || !input.catalogScope) {
    return null;
  }

  const value = (input.catalogScope as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function locationNumber(
  input: CaptureFinalizeInput["location"],
  key: "latitude" | "longitude",
): number | null {
  if (!input || typeof input.resolvedPosition !== "object" || !input.resolvedPosition) {
    return null;
  }

  const value = (input.resolvedPosition as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildCaptureFileSummary(
  row: typeof captureFiles.$inferSelect | null,
): ActivityCaptureFileSummary | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    kind: row.kind === "raw_iq" ? "raw_iq" : "audio",
    format: row.format,
    relativePath: row.relativePath,
    url: `/api/capture-files/${row.id}`,
  };
}

function toActivityLogEntry(
  row: typeof activityEvents.$inferSelect,
  session: typeof captureSessions.$inferSelect | null,
  audioFile: typeof captureFiles.$inferSelect | null,
  rawIqFile: typeof captureFiles.$inferSelect | null,
): ActivityLogEntry {
  return {
    id: row.id,
    burstEventId: session?.burstEventId ?? null,
    module: row.module as ActivityEventModule,
    mode: row.mode as ActivityLogEntry["mode"],
    label: row.label,
    freqMhz: row.freqHz / 1_000_000,
    rms: row.rmsPeak ?? row.rmsAvg ?? 0,
    time: formatDisplayTime(row.startedAtMs),
    occurredAt: new Date(row.startedAtMs).toISOString(),
    bandId: row.bandId,
    channelId: row.channelId,
    channelNumber: row.channelNumber,
    captureStatus: session ? "saved" : "none",
    captureSessionId: session?.id ?? null,
    audioCapture: buildCaptureFileSummary(audioFile),
    rawIqCapture: buildCaptureFileSummary(rawIqFile),
  };
}

function findCandidateActivityEvent(input: CaptureFinalizeInput): typeof activityEvents.$inferSelect | null {
  const inputMetadata = jsonObject(input.metadata ?? null);
  const inputStreamId = metadataStringValue(inputMetadata, "streamId");
  const inputRadioSessionId = metadataStringValue(inputMetadata, "radioSessionId");

  if (input.activityEventId) {
    const exact = appDb
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.id, input.activityEventId))
      .limit(1)
      .get() ?? null;

    if (
      exact
      && exact.module === input.module
      && exact.mode === input.mode
      && exact.freqHz === input.freqHz
      && (!input.channelId || exact.channelId === input.channelId)
      && (
        input.channelNumber === null
        || input.channelNumber === undefined
        || exact.channelNumber === input.channelNumber
      )
      && exact.startedAtMs >= input.startedAtMs - CAPTURE_MATCH_LOOKBACK_MS
      && exact.startedAtMs <= input.endedAtMs + CAPTURE_MATCH_LOOKAHEAD_MS
    ) {
      if (
        (!inputStreamId || !exact.streamId || exact.streamId === inputStreamId)
        && (
          !inputRadioSessionId
          || !exact.radioSessionId
          || exact.radioSessionId === inputRadioSessionId
        )
      ) {
        return exact;
      }
    }
  }

  const candidates = appDb
    .select()
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.module, input.module),
        eq(activityEvents.mode, input.mode),
        eq(activityEvents.freqHz, input.freqHz),
        gte(activityEvents.startedAtMs, input.startedAtMs - CAPTURE_MATCH_LOOKBACK_MS),
        lte(activityEvents.startedAtMs, input.endedAtMs + CAPTURE_MATCH_LOOKAHEAD_MS),
      ),
    )
    .orderBy(desc(activityEvents.startedAtMs))
    .limit(20)
    .all();

  if (candidates.length === 0) {
    return null;
  }

  let best: typeof activityEvents.$inferSelect | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    if (input.channelId && candidate.channelId !== input.channelId) {
      continue;
    }
    if (
      input.channelNumber !== null
      && input.channelNumber !== undefined
      && candidate.channelNumber !== input.channelNumber
    ) {
      continue;
    }
    const candidateStreamId = candidate.streamId;
    const candidateRadioSessionId = candidate.radioSessionId;

    if (inputStreamId && candidateStreamId && candidateStreamId !== inputStreamId) {
      continue;
    }
    if (inputRadioSessionId && candidateRadioSessionId && candidateRadioSessionId !== inputRadioSessionId) {
      continue;
    }

    let score = 0;
    if (inputStreamId && candidateStreamId === inputStreamId) {
      score += 50;
    }
    if (inputRadioSessionId && candidateRadioSessionId === inputRadioSessionId) {
      score += 50;
    }
    if (input.channelId && candidate.channelId === input.channelId) {
      score += 40;
    }
    if (
      input.channelNumber !== null
      && input.channelNumber !== undefined
      && candidate.channelNumber === input.channelNumber
    ) {
      score += 30;
    }
    if (candidate.label === input.label) {
      score += 20;
    }
    if (candidate.mode === input.mode) {
      score += 10;
    }
    const timeDelta = Math.abs(candidate.startedAtMs - input.startedAtMs);
    score += Math.max(0, 15 - Math.floor(timeDelta / 1000));

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return bestScore >= 20 ? best : null;
}

function createFallbackActivityEvent(input: CaptureFinalizeInput): typeof activityEvents.$inferSelect {
  const nowMs = Date.now();
  const row: typeof activityEvents.$inferInsert = {
    id: randomUUID(),
    scanRunId: null,
    module: input.module,
    mode: input.mode,
    label: input.label.trim() || "Unknown activity",
    bandId: input.bandId ?? null,
    channelId: input.channelId ?? null,
    channelNumber: input.channelNumber ?? null,
    demodMode: input.demodMode,
    freqHz: input.freqHz,
    centerFreqHz: null,
    startedAtMs: input.startedAtMs,
    endedAtMs: input.endedAtMs,
    durationMs: Math.max(0, input.endedAtMs - input.startedAtMs),
    rmsAvg: input.rmsAvg ?? input.rmsPeak ?? null,
    rmsPeak: input.rmsPeak ?? input.rmsAvg ?? null,
    rfPeak: input.rfPeak ?? null,
    squelch: input.squelch ?? null,
    regionId: locationString(input.location, "regionId"),
    countryId: locationString(input.location, "countryId"),
    cityId: locationString(input.location, "cityId"),
    locationSource:
      typeof input.location?.sourceMode === "string" ? input.location.sourceMode : null,
    locationLatitude: locationNumber(input.location, "latitude"),
    locationLongitude: locationNumber(input.location, "longitude"),
    radioSessionId: metadataStringValue(jsonObject(input.metadata ?? null), "radioSessionId"),
    streamId: metadataStringValue(jsonObject(input.metadata ?? null), "streamId"),
    metadataJson: safeJson(input.metadata ?? null),
    createdAtMs: nowMs,
  };

  appDb.insert(activityEvents).values(row).run();

  return {
    scanRunId: null,
    ...row,
  } as typeof activityEvents.$inferSelect;
}

function updateActivityEventFromCapture(
  row: typeof activityEvents.$inferSelect,
  input: CaptureFinalizeInput,
): void {
  const nextEndedAtMs = Math.max(row.endedAtMs, input.endedAtMs);
  const nextDurationMs = Math.max(row.durationMs ?? 0, nextEndedAtMs - row.startedAtMs);
  const nextRmsPeak =
    row.rmsPeak === null
      ? (input.rmsPeak ?? input.rmsAvg ?? null)
      : Math.max(row.rmsPeak, input.rmsPeak ?? input.rmsAvg ?? 0);
  const nextRmsAvg =
    row.rmsAvg === null
      ? (input.rmsAvg ?? input.rmsPeak ?? null)
      : input.rmsAvg === null || input.rmsAvg === undefined
        ? row.rmsAvg
        : (row.rmsAvg + input.rmsAvg) / 2;
  const nextRfPeak =
    row.rfPeak === null
      ? (input.rfPeak ?? null)
      : input.rfPeak === null || input.rfPeak === undefined
        ? row.rfPeak
        : Math.max(row.rfPeak, input.rfPeak);

  appDb
    .update(activityEvents)
    .set({
      endedAtMs: nextEndedAtMs,
      durationMs: nextDurationMs,
      rmsPeak: nextRmsPeak,
      rmsAvg: nextRmsAvg,
      rfPeak: nextRfPeak,
      squelch: row.squelch ?? input.squelch ?? null,
      regionId: row.regionId ?? locationString(input.location, "regionId"),
      countryId: row.countryId ?? locationString(input.location, "countryId"),
      cityId: row.cityId ?? locationString(input.location, "cityId"),
      locationSource: row.locationSource ?? (typeof input.location?.sourceMode === "string" ? input.location.sourceMode : null),
      locationLatitude: row.locationLatitude ?? locationNumber(input.location, "latitude"),
      locationLongitude: row.locationLongitude ?? locationNumber(input.location, "longitude"),
      radioSessionId: row.radioSessionId ?? metadataStringValue(jsonObject(input.metadata ?? null), "radioSessionId"),
      streamId: row.streamId ?? metadataStringValue(jsonObject(input.metadata ?? null), "streamId"),
      metadataJson: row.metadataJson ?? safeJson(input.metadata ?? null),
    })
    .where(eq(activityEvents.id, row.id))
    .run();
}

function findExactBurstEvent(
  input: CaptureFinalizeInput,
  fallbackBurstEventId: string | null = null,
): typeof burstEvents.$inferSelect | null {
  const burstEventId = input.burstEventId ?? fallbackBurstEventId ?? null;
  if (!burstEventId) {
    return null;
  }

  const exact = appDb
    .select()
    .from(burstEvents)
    .where(eq(burstEvents.id, burstEventId))
    .limit(1)
    .get() ?? null;

  if (!exact) {
    return null;
  }

  if (
    exact.module !== input.module
    || exact.mode !== input.mode
    || exact.freqHz !== input.freqHz
    || (input.channelId && exact.channelId !== input.channelId)
    || (
      input.channelNumber !== null
      && input.channelNumber !== undefined
      && exact.channelNumber !== input.channelNumber
    )
  ) {
    return null;
  }

  return exact;
}

function createBurstEventFromCapture(
  input: CaptureFinalizeInput,
  activityEventId: string | null,
): typeof burstEvents.$inferSelect {
  const nowMs = Date.now();
  const inputMetadata = jsonObject(input.metadata ?? null);
  const row: typeof burstEvents.$inferInsert = {
    id: input.burstEventId ?? randomUUID(),
    scanRunId: null,
    activityEventId,
    module: input.module,
    mode: input.mode,
    label: input.label.trim() || "Unknown burst",
    bandId: input.bandId ?? null,
    channelId: input.channelId ?? null,
    channelNumber: input.channelNumber ?? null,
    demodMode: input.demodMode,
    freqHz: input.freqHz,
    centerFreqHz: null,
    startedAtMs: input.startedAtMs,
    endedAtMs: input.endedAtMs,
    durationMs: Math.max(0, input.endedAtMs - input.startedAtMs),
    rmsAvg: input.rmsAvg ?? input.rmsPeak ?? null,
    rmsPeak: input.rmsPeak ?? input.rmsAvg ?? null,
    rfPeak: input.rfPeak ?? null,
    squelch: input.squelch ?? null,
    deviceLabel: input.deviceLabel ?? null,
    deviceSerial: input.deviceSerial ?? null,
    locationJson: safeJson(input.location ?? null),
    radioSessionId: metadataStringValue(inputMetadata, "radioSessionId"),
    streamId: metadataStringValue(inputMetadata, "streamId"),
    metadataJson: safeJson(input.metadata ?? null),
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };

  appDb.insert(burstEvents).values(row).run();

  return {
    ...row,
    scanRunId: null,
  } as typeof burstEvents.$inferSelect;
}

function updateBurstEventFromCapture(
  row: typeof burstEvents.$inferSelect,
  input: CaptureFinalizeInput,
  activityEventId: string | null,
): void {
  const nextEndedAtMs = Math.max(row.endedAtMs, input.endedAtMs);
  const nextDurationMs = Math.max(row.durationMs ?? 0, nextEndedAtMs - row.startedAtMs);
  const nextRmsPeak =
    row.rmsPeak === null
      ? (input.rmsPeak ?? input.rmsAvg ?? null)
      : Math.max(row.rmsPeak, input.rmsPeak ?? input.rmsAvg ?? 0);
  const nextRmsAvg =
    row.rmsAvg === null
      ? (input.rmsAvg ?? input.rmsPeak ?? null)
      : input.rmsAvg === null || input.rmsAvg === undefined
        ? row.rmsAvg
        : (row.rmsAvg + input.rmsAvg) / 2;
  const nextRfPeak =
    row.rfPeak === null
      ? (input.rfPeak ?? null)
      : input.rfPeak === null || input.rfPeak === undefined
        ? row.rfPeak
        : Math.max(row.rfPeak, input.rfPeak);

  appDb
    .update(burstEvents)
    .set({
      activityEventId: row.activityEventId ?? activityEventId,
      endedAtMs: nextEndedAtMs,
      durationMs: nextDurationMs,
      rmsPeak: nextRmsPeak,
      rmsAvg: nextRmsAvg,
      rfPeak: nextRfPeak,
      squelch: row.squelch ?? input.squelch ?? null,
      deviceLabel: row.deviceLabel ?? input.deviceLabel ?? null,
      deviceSerial: row.deviceSerial ?? input.deviceSerial ?? null,
      locationJson: row.locationJson ?? safeJson(input.location ?? null),
      radioSessionId: row.radioSessionId ?? metadataStringValue(jsonObject(input.metadata ?? null), "radioSessionId"),
      streamId: row.streamId ?? metadataStringValue(jsonObject(input.metadata ?? null), "streamId"),
      metadataJson: row.metadataJson ?? safeJson(input.metadata ?? null),
      updatedAtMs: Date.now(),
    })
    .where(eq(burstEvents.id, row.id))
    .run();
}

function findPersistedCaptureByPath(relativePath: string | null): typeof captureFiles.$inferSelect | null {
  if (!relativePath) {
    return null;
  }

  return appDb
    .select()
    .from(captureFiles)
    .where(eq(captureFiles.relativePath, relativePath))
    .limit(1)
    .get() ?? null;
}

function fileByteSize(absolutePath: string | null | undefined): number | null {
  if (!absolutePath) {
    return null;
  }

  try {
    return statSync(absolutePath).size;
  } catch {
    return null;
  }
}

export function listActivityEvents(
  module: ActivityEventModule,
  limit = 25,
): ActivityLogEntry[] {
  const rows = appDb
    .select()
    .from(activityEvents)
    .where(eq(activityEvents.module, module))
    .orderBy(desc(activityEvents.startedAtMs))
    .limit(Math.max(1, Math.min(limit, 250)))
    .all();

  if (rows.length === 0) {
    return [];
  }

  const eventIds = rows.map((row) => row.id);
  const sessions = appDb
    .select()
    .from(captureSessions)
    .where(inArray(captureSessions.activityEventId, eventIds))
    .orderBy(desc(captureSessions.startedAtMs))
    .all();

  const latestSessionByEventId = new Map<string, typeof captureSessions.$inferSelect>();
  for (const session of sessions) {
    if (session.activityEventId && !latestSessionByEventId.has(session.activityEventId)) {
      latestSessionByEventId.set(session.activityEventId, session);
    }
  }

  const sessionIds = [...latestSessionByEventId.values()].map((session) => session.id);
  const files = sessionIds.length > 0
    ? appDb
      .select()
      .from(captureFiles)
      .where(inArray(captureFiles.captureSessionId, sessionIds))
      .all()
    : [];

  const audioFileBySessionId = new Map<string, typeof captureFiles.$inferSelect>();
  const rawIqFileBySessionId = new Map<string, typeof captureFiles.$inferSelect>();
  for (const file of files) {
    if (file.kind === "audio" && !audioFileBySessionId.has(file.captureSessionId)) {
      audioFileBySessionId.set(file.captureSessionId, file);
    }
    if (file.kind === "raw_iq" && !rawIqFileBySessionId.has(file.captureSessionId)) {
      rawIqFileBySessionId.set(file.captureSessionId, file);
    }
  }

  return rows.map((row) => {
    const session = latestSessionByEventId.get(row.id) ?? null;
    return toActivityLogEntry(
      row,
      session,
      session ? (audioFileBySessionId.get(session.id) ?? null) : null,
      session ? (rawIqFileBySessionId.get(session.id) ?? null) : null,
    );
  });
}

export function createActivityEvent(input: CreateActivityEventInput): ActivityLogEntry {
  const occurredAtMs = Number.isFinite(Date.parse(input.occurredAt))
    ? Date.parse(input.occurredAt)
    : Date.now();
  const nowMs = Date.now();
  const inputMetadata = jsonObject(input.metadata ?? null);

  const row: typeof activityEvents.$inferInsert = {
    id: randomUUID(),
    module: input.module,
    mode: input.mode,
    label: input.label.trim() || "Unknown activity",
    bandId: input.bandId ?? null,
    channelId: input.channelId ?? null,
    channelNumber: input.channelNumber ?? null,
    demodMode: input.demodMode ?? null,
    freqHz: Math.round(input.freqMhz * 1_000_000),
    centerFreqHz: null,
    startedAtMs: occurredAtMs,
    endedAtMs: occurredAtMs,
    durationMs: null,
    rmsAvg: input.rms,
    rmsPeak: input.rms,
    rfPeak: null,
    squelch: input.squelch ?? null,
    regionId: input.location?.catalogScope.regionId ?? null,
    countryId: input.location?.catalogScope.countryId ?? null,
    cityId: input.location?.catalogScope.cityId ?? null,
    locationSource: input.location?.sourceMode ?? null,
    locationLatitude: input.location?.resolvedPosition?.latitude ?? null,
    locationLongitude: input.location?.resolvedPosition?.longitude ?? null,
    radioSessionId: metadataStringValue(inputMetadata, "radioSessionId"),
    streamId: metadataStringValue(inputMetadata, "streamId"),
    metadataJson: safeJson(input.metadata ?? null),
    createdAtMs: nowMs,
  };

  appDb.insert(activityEvents).values(row).run();

  return toActivityLogEntry(
    {
      scanRunId: null,
      ...row,
    } as typeof activityEvents.$inferSelect,
    null,
    null,
    null,
  );
}

export function createCaptureBoundActivityEvent(
  input: CreateActivityEventInput,
): ActivityLogEntry {
  const entry = createActivityEvent(input);
  const occurredAtMs = Number.isFinite(Date.parse(input.occurredAt))
    ? Date.parse(input.occurredAt)
    : Date.now();
  const burst = createBurstEventFromCapture(
    {
      module: input.module,
      mode: input.mode,
      activityEventId: entry.id,
      burstEventId: null,
      label: input.label,
      freqHz: Math.round(input.freqMhz * 1_000_000),
      demodMode: input.demodMode ?? "nfm",
      bandId: input.bandId ?? null,
      channelId: input.channelId ?? null,
      channelNumber: input.channelNumber ?? null,
      startedAtMs: occurredAtMs,
      endedAtMs: occurredAtMs,
      rmsAvg: input.rms,
      rmsPeak: input.rms,
      rfPeak: null,
      squelch: input.squelch ?? null,
      deviceLabel: null,
      deviceSerial: null,
      location: input.location ?? null,
      metadata: input.metadata ?? null,
    },
    entry.id,
  );

  return {
    ...entry,
    burstEventId: burst.id,
  };
}

export function persistCapturedActivity(input: CaptureFinalizeInput): void {
  const audioRelativePath = input.audioAbsolutePath ? captureRelativePath(input.audioAbsolutePath) : null;
  const iqRelativePath = input.iqAbsolutePath ? captureRelativePath(input.iqAbsolutePath) : null;

  if (!audioRelativePath && !iqRelativePath) {
    return;
  }

  const persistedAudio = findPersistedCaptureByPath(audioRelativePath);
  const persistedIq = findPersistedCaptureByPath(iqRelativePath);
  if (persistedAudio && persistedIq) {
    return;
  }

  const event = findCandidateActivityEvent(input) ?? createFallbackActivityEvent(input);
  updateActivityEventFromCapture(event, input);

  const nowMs = Date.now();
  const sessionId = persistedAudio?.captureSessionId ?? persistedIq?.captureSessionId ?? randomUUID();
  const existingSession = appDb
    .select()
    .from(captureSessions)
    .where(eq(captureSessions.id, sessionId))
    .limit(1)
    .get() ?? null;
  const inputMetadata = jsonObject(input.metadata ?? null);
  const inputRadioSessionId = metadataStringValue(inputMetadata, "radioSessionId") ?? event.radioSessionId ?? null;
  const inputStreamId = metadataStringValue(inputMetadata, "streamId") ?? event.streamId ?? null;
  const burst =
    findExactBurstEvent(input, existingSession?.burstEventId ?? null)
    ?? createBurstEventFromCapture(input, event.id);
  updateBurstEventFromCapture(burst, input, event.id);

  if (!persistedAudio && !persistedIq) {
    appDb.insert(captureSessions).values({
      id: sessionId,
      scanRunId: null,
      activityEventId: event.id,
      burstEventId: burst.id,
      module: input.module,
      reason: input.mode === "scan" ? "scan-hit" : "manual",
      status: "saved",
      startedAtMs: input.startedAtMs,
      endedAtMs: input.endedAtMs,
      freqHz: input.freqHz,
      centerFreqHz: null,
      demodMode: input.demodMode,
      deviceLabel: input.deviceLabel ?? null,
      deviceSerial: input.deviceSerial ?? null,
      locationJson: safeJson(input.location ?? null),
      radioSessionId: inputRadioSessionId,
      streamId: inputStreamId,
      metadataJson: safeJson(input.metadata ?? null),
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    }).run();
  } else {
    appDb.update(captureSessions).set({
      activityEventId: event.id,
      burstEventId: burst.id,
      endedAtMs: input.endedAtMs,
      radioSessionId: inputRadioSessionId,
      streamId: inputStreamId,
      updatedAtMs: nowMs,
    }).where(eq(captureSessions.id, sessionId)).run();
  }

  const filesToInsert: Array<typeof captureFiles.$inferInsert> = [];

  if (audioRelativePath && !persistedAudio && capturePathExists(audioRelativePath)) {
    filesToInsert.push({
      id: randomUUID(),
      captureSessionId: sessionId,
      kind: "audio",
      format: "wav",
      relativePath: audioRelativePath,
      byteSize: fileByteSize(input.audioAbsolutePath),
      sha256: null,
      sampleRate: 50_000,
      createdAtMs: nowMs,
      metadataJson: null,
    });
  }

  if (iqRelativePath && !persistedIq && capturePathExists(iqRelativePath)) {
    filesToInsert.push({
      id: randomUUID(),
      captureSessionId: sessionId,
      kind: "raw_iq",
      format: "cs8",
      relativePath: iqRelativePath,
      byteSize: fileByteSize(input.iqAbsolutePath),
      sha256: null,
      sampleRate: 2_000_000,
      createdAtMs: nowMs,
      metadataJson: null,
    });
  }

  if (filesToInsert.length > 0) {
    appDb.insert(captureFiles).values(filesToInsert).run();
  }

  if (filesToInsert.some((file) => file.kind === "audio")) {
    queueCaptureAnalysisJob(sessionId, burst.id);
  }
}

export function clearActivityEvents(module: ActivityEventModule): void {
  const sessions = appDb
    .select()
    .from(captureSessions)
    .where(eq(captureSessions.module, module))
    .all();

  const sessionIds = sessions.map((session) => session.id);
  const files = sessionIds.length > 0
    ? appDb
      .select()
      .from(captureFiles)
      .where(inArray(captureFiles.captureSessionId, sessionIds))
      .all()
    : [];

  if (sessionIds.length > 0) {
    appDb.delete(captureSessions).where(eq(captureSessions.module, module)).run();
  }

  appDb.delete(burstEvents).where(eq(burstEvents.module, module)).run();
  appDb.delete(activityEvents).where(eq(activityEvents.module, module)).run();

  for (const file of files) {
    const absolutePath = captureAbsolutePath(file.relativePath);
    if (!absolutePath) {
      continue;
    }

    try {
      rmSync(absolutePath, { force: true });
    } catch {
      // Best-effort cleanup of runtime captures.
    }
  }
}
