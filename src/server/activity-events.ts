import { randomUUID } from "node:crypto";

import { desc, eq } from "drizzle-orm";

import type {
  ActivityEventModule,
  ActivityLogEntry,
  CreateActivityEventInput,
} from "@/lib/activity-events";
import { appDb } from "@/server/db/client";
import { activityEvents } from "@/server/db/schema";

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

function toActivityLogEntry(row: typeof activityEvents.$inferSelect): ActivityLogEntry {
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
  };
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

  return rows.map(toActivityLogEntry);
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

  return toActivityLogEntry({
    scanRunId: null,
    ...row,
  } as typeof activityEvents.$inferSelect);
}

export function clearActivityEvents(module: ActivityEventModule): void {
  appDb.delete(activityEvents).where(eq(activityEvents.module, module)).run();
}
