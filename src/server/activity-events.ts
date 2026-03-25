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
import { appDb } from "@/server/db/client";
import { activityEvents, captureFiles, captureSessions } from "@/server/db/schema";
import { captureAbsolutePath, capturePathExists, captureRelativePath } from "@/server/storage";

const CAPTURE_MATCH_LOOKBACK_MS = 20_000;
const CAPTURE_MATCH_LOOKAHEAD_MS = 5_000;

type CaptureFinalizeInput = {
  module: ActivityEventModule;
  mode: ActivityLogEntry["mode"];
  label: string;
  freqHz: number;
  demodMode: AudioDemodMode;
  bandId?: string | null;
  channelId?: string | null;
  channelNumber?: number | null;
  startedAtMs: number;
  endedAtMs: number;
  rms?: number | null;
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
  const candidates = appDb
    .select()
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.module, input.module),
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
    let score = 0;
    if (input.channelId && candidate.channelId === input.channelId) {
      score += 40;
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

  return best;
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
    rmsAvg: input.rms ?? null,
    rmsPeak: input.rms ?? null,
    rfPeak: null,
    squelch: input.squelch ?? null,
    regionId: locationString(input.location, "regionId"),
    countryId: locationString(input.location, "countryId"),
    cityId: locationString(input.location, "cityId"),
    locationSource:
      typeof input.location?.sourceMode === "string" ? input.location.sourceMode : null,
    locationLatitude: locationNumber(input.location, "latitude"),
    locationLongitude: locationNumber(input.location, "longitude"),
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
  const nextRmsPeak = Math.max(row.rmsPeak ?? 0, input.rms ?? 0);
  const nextRmsAvg =
    row.rmsAvg === null
      ? (input.rms ?? null)
      : input.rms === null || input.rms === undefined
        ? row.rmsAvg
        : (row.rmsAvg + input.rms) / 2;

  appDb
    .update(activityEvents)
    .set({
      endedAtMs: nextEndedAtMs,
      durationMs: nextDurationMs,
      rmsPeak: nextRmsPeak,
      rmsAvg: nextRmsAvg,
      squelch: row.squelch ?? input.squelch ?? null,
      regionId: row.regionId ?? locationString(input.location, "regionId"),
      countryId: row.countryId ?? locationString(input.location, "countryId"),
      cityId: row.cityId ?? locationString(input.location, "cityId"),
      locationSource: row.locationSource ?? (typeof input.location?.sourceMode === "string" ? input.location.sourceMode : null),
      locationLatitude: row.locationLatitude ?? locationNumber(input.location, "latitude"),
      locationLongitude: row.locationLongitude ?? locationNumber(input.location, "longitude"),
      metadataJson: row.metadataJson ?? safeJson(input.metadata ?? null),
    })
    .where(eq(activityEvents.id, row.id))
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

export function persistCapturedActivity(input: CaptureFinalizeInput): void {
  const audioRelativePath = input.audioAbsolutePath ? captureRelativePath(input.audioAbsolutePath) : null;
  const iqRelativePath = input.iqAbsolutePath ? captureRelativePath(input.iqAbsolutePath) : null;

  if (!audioRelativePath && !iqRelativePath) {
    return;
  }

  const persistedAudio = findPersistedCaptureByPath(audioRelativePath);
  const persistedIq = findPersistedCaptureByPath(iqRelativePath);
  if (persistedAudio || persistedIq) {
    return;
  }

  const event = findCandidateActivityEvent(input) ?? createFallbackActivityEvent(input);
  updateActivityEventFromCapture(event, input);

  const nowMs = Date.now();
  const sessionId = randomUUID();

  appDb.insert(captureSessions).values({
    id: sessionId,
    scanRunId: null,
    activityEventId: event.id,
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
    metadataJson: safeJson(input.metadata ?? null),
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  }).run();

  const filesToInsert: Array<typeof captureFiles.$inferInsert> = [];

  if (audioRelativePath && capturePathExists(audioRelativePath)) {
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

  if (iqRelativePath && capturePathExists(iqRelativePath)) {
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
