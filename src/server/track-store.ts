import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";

import type {
  AdsbAircraftContact,
  AdsbReceiverInfo,
  AdsbTrackHistoryResponse,
  AdsbTrackPoint,
  AisTrackHistoryResponse,
  AisTrackPoint,
  AisVesselContact,
} from "@/lib/types";
import { appDb, sqliteDb } from "@/server/db/client";
import { adsbTrackPoints, aisTrackPoints } from "@/server/db/schema";

function toMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function toIso(value: number | null): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : null;
}

export function persistAdsbTrackPoints(
  aircraft: AdsbAircraftContact[],
  receiver: AdsbReceiverInfo | null,
  generatedAt: string | null,
): void {
  const generatedAtMs = toMs(generatedAt);
  const rows = aircraft
    .filter(
      (entry): entry is AdsbAircraftContact & {
        latitude: number;
        longitude: number;
        seenPosAt: string;
      } =>
        entry.latitude !== null
        && entry.longitude !== null
        && entry.seenPosAt !== null,
    )
    .map((entry) => {
      const seenAtMs = toMs(entry.seenAt) ?? Date.now();
      const seenPosAtMs = toMs(entry.seenPosAt) ?? seenAtMs;
      const observationKey = [
        entry.hex,
        seenPosAtMs,
        entry.latitude.toFixed(5),
        entry.longitude.toFixed(5),
        entry.altitudeFeet ?? "",
      ].join(":");

      return {
        id: randomUUID(),
        observationKey,
        hex: entry.hex,
        flight: clampText(entry.flight),
        type: clampText(entry.type),
        category: clampText(entry.category),
        squawk: clampText(entry.squawk),
        emergency: clampText(entry.emergency),
        sourceLabel: clampText(entry.sourceLabel),
        latitude: entry.latitude,
        longitude: entry.longitude,
        altitudeFeet: entry.altitudeFeet,
        groundSpeedKnots: entry.groundSpeedKnots,
        trackDeg: entry.trackDeg,
        verticalRateFpm: entry.verticalRateFpm,
        onGround: entry.onGround,
        messageCount: entry.messageCount,
        rssi: entry.rssi,
        seenAtMs,
        seenPosAtMs,
        generatedAtMs,
        receiverLatitude: receiver?.latitude ?? null,
        receiverLongitude: receiver?.longitude ?? null,
        metadataJson: safeJson(entry),
        createdAtMs: Date.now(),
      };
    });

  if (rows.length === 0) {
    return;
  }

  appDb
    .insert(adsbTrackPoints)
    .values(rows)
    .onConflictDoNothing({ target: adsbTrackPoints.observationKey })
    .run();
}

export function persistAisTrackPoint(
  vessel: AisVesselContact,
  options?: {
    channelId?: string | null;
    headingDeg?: number | null;
    messageTypeCode?: number | null;
    phase?: number | null;
    metadata?: Record<string, unknown> | null;
  },
): void {
  const lastSeenAtMs = toMs(vessel.lastSeenAt) ?? Date.now();
  const lastPositionAtMs = toMs(vessel.lastPositionAt) ?? lastSeenAtMs;
  const observationKey = [
    vessel.mmsi,
    lastPositionAtMs,
    vessel.latitude.toFixed(5),
    vessel.longitude.toFixed(5),
    vessel.courseDeg ?? "",
    vessel.speedKnots ?? "",
  ].join(":");

  appDb
    .insert(aisTrackPoints)
    .values({
      id: randomUUID(),
      observationKey,
      mmsi: vessel.mmsi,
      name: clampText(vessel.name),
      callsign: clampText(vessel.callsign),
      imo: clampText(vessel.imo),
      shipType: clampText(vessel.shipType),
      destination: clampText(vessel.destination),
      navStatus: clampText(vessel.navStatus),
      messageType: clampText(vessel.messageType),
      messageTypeCode: options?.messageTypeCode ?? null,
      sourceLabel: clampText(vessel.sourceLabel),
      channelId: options?.channelId ?? null,
      phase: options?.phase ?? null,
      latitude: vessel.latitude,
      longitude: vessel.longitude,
      speedKnots: vessel.speedKnots,
      courseDeg: vessel.courseDeg,
      headingDeg: options?.headingDeg ?? null,
      isMoving: vessel.isMoving,
      lastSeenAtMs,
      lastPositionAtMs,
      lastStaticAtMs: toMs(vessel.lastStaticAt),
      metadataJson: safeJson(options?.metadata ?? vessel),
      createdAtMs: Date.now(),
    })
    .onConflictDoNothing({ target: aisTrackPoints.observationKey })
    .run();
}

function toAdsbTrackPoint(
  row: typeof adsbTrackPoints.$inferSelect,
): AdsbTrackPoint {
  return {
    id: row.id,
    observationKey: row.observationKey,
    hex: row.hex,
    flight: row.flight ?? "",
    type: row.type ?? "",
    category: row.category ?? "",
    squawk: row.squawk ?? "",
    emergency: row.emergency ?? "",
    sourceLabel: row.sourceLabel ?? "",
    latitude: row.latitude,
    longitude: row.longitude,
    altitudeFeet: row.altitudeFeet,
    groundSpeedKnots: row.groundSpeedKnots,
    trackDeg: row.trackDeg,
    verticalRateFpm: row.verticalRateFpm,
    onGround: row.onGround,
    messageCount: row.messageCount,
    rssi: row.rssi,
    seenAt: new Date(row.seenAtMs).toISOString(),
    seenPosAt: toIso(row.seenPosAtMs),
    generatedAt: toIso(row.generatedAtMs),
    receiverLatitude: row.receiverLatitude,
    receiverLongitude: row.receiverLongitude,
    metadata: parseJsonRecord(row.metadataJson),
  };
}

function toAisTrackPoint(
  row: typeof aisTrackPoints.$inferSelect,
): AisTrackPoint {
  return {
    id: row.id,
    observationKey: row.observationKey,
    mmsi: row.mmsi,
    name: row.name ?? "",
    callsign: row.callsign ?? "",
    imo: row.imo ?? "",
    shipType: row.shipType ?? "",
    destination: row.destination ?? "",
    navStatus: row.navStatus ?? "",
    messageType: row.messageType ?? "",
    messageTypeCode: row.messageTypeCode,
    sourceLabel: row.sourceLabel ?? "",
    channelId: row.channelId,
    phase: row.phase,
    latitude: row.latitude,
    longitude: row.longitude,
    speedKnots: row.speedKnots,
    courseDeg: row.courseDeg,
    headingDeg: row.headingDeg,
    isMoving: row.isMoving,
    lastSeenAt: new Date(row.lastSeenAtMs).toISOString(),
    lastPositionAt: new Date(row.lastPositionAtMs).toISOString(),
    lastStaticAt: toIso(row.lastStaticAtMs),
    metadata: parseJsonRecord(row.metadataJson),
  };
}

export function listAdsbTrackHistory(
  hex: string,
  limit = 2000,
): AdsbTrackHistoryResponse {
  const safeHex = hex.trim().toUpperCase();
  const rows = appDb
    .select()
    .from(adsbTrackPoints)
    .where(eq(adsbTrackPoints.hex, safeHex))
    .orderBy(asc(adsbTrackPoints.seenAtMs))
    .limit(Math.max(1, Math.min(limit, 10_000)))
    .all();

  return {
    hex: safeHex,
    pointCount: rows.length,
    firstSeenAt: rows.length > 0 ? new Date(rows[0].seenAtMs).toISOString() : null,
    lastSeenAt: rows.length > 0 ? new Date(rows[rows.length - 1].seenAtMs).toISOString() : null,
    points: rows.map(toAdsbTrackPoint),
  };
}

export function listRecentAdsbContacts(limit = 100): AdsbAircraftContact[] {
  const rows = sqliteDb
    .prepare(`
      SELECT *
      FROM (
        SELECT
          hex,
          flight,
          type,
          category,
          squawk,
          emergency,
          latitude,
          longitude,
          altitude_feet AS altitudeFeet,
          ground_speed_knots AS groundSpeedKnots,
          track_deg AS trackDeg,
          vertical_rate_fpm AS verticalRateFpm,
          on_ground AS onGround,
          message_count AS messageCount,
          rssi,
          seen_at_ms AS seenAtMs,
          seen_pos_at_ms AS seenPosAtMs,
          source_label AS sourceLabel,
          ROW_NUMBER() OVER (
            PARTITION BY hex
            ORDER BY COALESCE(seen_pos_at_ms, seen_at_ms) DESC, created_at_ms DESC
          ) AS row_num
        FROM adsb_track_points
      )
      WHERE row_num = 1
      ORDER BY COALESCE(seenPosAtMs, seenAtMs) DESC
      LIMIT ?
    `)
    .all(Math.max(1, Math.min(limit, 500))) as Array<{
      hex: string;
      flight: string | null;
      type: string | null;
      category: string | null;
      squawk: string | null;
      emergency: string | null;
      latitude: number | null;
      longitude: number | null;
      altitudeFeet: number | null;
      groundSpeedKnots: number | null;
      trackDeg: number | null;
      verticalRateFpm: number | null;
      onGround: number;
      messageCount: number;
      rssi: number | null;
      seenAtMs: number;
      seenPosAtMs: number | null;
      sourceLabel: string | null;
    }>;

  return rows.map((row) => ({
    hex: row.hex,
    flight: row.flight ?? "",
    type: row.type ?? "",
    category: row.category ?? "",
    squawk: row.squawk ?? "",
    emergency: row.emergency ?? "",
    latitude: row.latitude,
    longitude: row.longitude,
    altitudeFeet: row.altitudeFeet,
    groundSpeedKnots: row.groundSpeedKnots,
    trackDeg: row.trackDeg,
    verticalRateFpm: row.verticalRateFpm,
    onGround: Boolean(row.onGround),
    messageCount: row.messageCount,
    rssi: row.rssi,
    seenAt: new Date(row.seenAtMs).toISOString(),
    seenPosAt: toIso(row.seenPosAtMs),
    sourceLabel: row.sourceLabel ?? "ADS-B",
  }));
}

export function listAisTrackHistory(
  mmsi: string,
  limit = 2000,
): AisTrackHistoryResponse {
  const safeMmsi = mmsi.trim();
  const rows = appDb
    .select()
    .from(aisTrackPoints)
    .where(eq(aisTrackPoints.mmsi, safeMmsi))
    .orderBy(asc(aisTrackPoints.lastPositionAtMs))
    .limit(Math.max(1, Math.min(limit, 10_000)))
    .all();

  return {
    mmsi: safeMmsi,
    pointCount: rows.length,
    firstPositionAt: rows.length > 0 ? new Date(rows[0].lastPositionAtMs).toISOString() : null,
    lastPositionAt: rows.length > 0 ? new Date(rows[rows.length - 1].lastPositionAtMs).toISOString() : null,
    points: rows.map(toAisTrackPoint),
  };
}

export function listRecentAisContacts(limit = 100): AisVesselContact[] {
  const rows = sqliteDb
    .prepare(`
      SELECT *
      FROM (
        SELECT
          mmsi,
          name,
          callsign,
          imo,
          ship_type AS shipType,
          destination,
          nav_status AS navStatus,
          message_type AS messageType,
          source_label AS sourceLabel,
          latitude,
          longitude,
          speed_knots AS speedKnots,
          course_deg AS courseDeg,
          heading_deg AS headingDeg,
          is_moving AS isMoving,
          last_seen_at_ms AS lastSeenAtMs,
          last_position_at_ms AS lastPositionAtMs,
          last_static_at_ms AS lastStaticAtMs,
          ROW_NUMBER() OVER (
            PARTITION BY mmsi
            ORDER BY last_position_at_ms DESC, created_at_ms DESC
          ) AS row_num
        FROM ais_track_points
      )
      WHERE row_num = 1
      ORDER BY lastPositionAtMs DESC
      LIMIT ?
    `)
    .all(Math.max(1, Math.min(limit, 500))) as Array<{
      mmsi: string;
      name: string | null;
      callsign: string | null;
      imo: string | null;
      shipType: string | null;
      destination: string | null;
      navStatus: string | null;
      messageType: string | null;
      sourceLabel: string | null;
      latitude: number;
      longitude: number;
      speedKnots: number | null;
      courseDeg: number | null;
      headingDeg: number | null;
      isMoving: number;
      lastSeenAtMs: number;
      lastPositionAtMs: number;
      lastStaticAtMs: number | null;
    }>;

  return rows.map((row) => ({
    mmsi: row.mmsi,
    name: row.name ?? "",
    callsign: row.callsign ?? "",
    imo: row.imo ?? "",
    shipType: row.shipType ?? "",
    destination: row.destination ?? "",
    latitude: row.latitude,
    longitude: row.longitude,
    speedKnots: row.speedKnots,
    courseDeg: row.courseDeg,
    headingDeg: row.headingDeg,
    navStatus: row.navStatus ?? "",
    lastSeenAt: new Date(row.lastSeenAtMs).toISOString(),
    lastPositionAt: new Date(row.lastPositionAtMs).toISOString(),
    lastStaticAt: toIso(row.lastStaticAtMs),
    messageType: row.messageType ?? "",
    sourceLabel: row.sourceLabel ?? "AIS",
    isMoving: Boolean(row.isMoving),
  }));
}
