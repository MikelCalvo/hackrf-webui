import { desc, eq, inArray } from "drizzle-orm";

import type {
  SigintAnalysisSummary,
  SigintCaptureDetail,
  SigintCaptureListFilters,
  SigintCaptureListResponse,
  SigintCaptureSummary,
  SigintReviewPriority,
  SigintReviewStatus,
  SigintReviewUpdateInput,
  SigintTrackKind,
  SigintTrackSummaryResponse,
} from "@/lib/sigint";
import { AUDIO_ANALYSIS_ENGINE } from "@/server/analysis-worker";
import { appDb, sqliteDb } from "@/server/db/client";
import {
  activityEvents,
  analysisFindings,
  analysisJobs,
  captureFiles,
  captureReviews,
  captureSessions,
  captureTags,
  captureTranscripts,
} from "@/server/db/schema";

type JsonRecord = Record<string, unknown>;

function parseJsonRecord(value: string | null): JsonRecord | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : null;
  } catch {
    return null;
  }
}

function toIso(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeReviewStatus(value: string | null | undefined): SigintReviewStatus {
  return value === "kept" || value === "discarded" || value === "flagged" ? value : "pending";
}

function normalizeReviewPriority(value: string | null | undefined): SigintReviewPriority {
  return value === "high" ? "high" : "normal";
}

function normalizeAnalysisStatus(value: string | null | undefined): SigintAnalysisSummary["status"] {
  return value === "queued" || value === "running" || value === "completed" || value === "failed"
    ? value
    : "none";
}

function emptyAnalysisSummary(): SigintAnalysisSummary {
  return {
    status: "none",
    engine: null,
    isCurrentEngine: null,
    model: null,
    classification: null,
    subclass: null,
    confidence: null,
    errorText: null,
    updatedAt: null,
    audioSeconds: null,
    rms: null,
    sceneLabel: null,
    sceneConfidence: null,
    voiceDetected: null,
    voiceConfidence: null,
    voiceRatio: null,
    voiceSeconds: null,
    voiceDetector: null,
    explanation: null,
    topLabels: [],
  };
}

function parseAnalysisSummary(
  jobs: Array<typeof analysisJobs.$inferSelect>,
  findingsByJobId: Map<string, Array<typeof analysisFindings.$inferSelect>>,
): SigintAnalysisSummary {
  if (jobs.length === 0) {
    return emptyAnalysisSummary();
  }

  const latestJob = [...jobs].sort((left, right) => right.createdAtMs - left.createdAtMs)[0];
  const summary: SigintAnalysisSummary = {
    ...emptyAnalysisSummary(),
    status: "none",
    engine: null,
    isCurrentEngine: null,
  };

  const preferredJob = [...jobs]
    .filter((row) => row.engine === AUDIO_ANALYSIS_ENGINE)
    .sort((left, right) => right.createdAtMs - left.createdAtMs)[0];
  const activeJob = preferredJob ?? latestJob;

  summary.status = normalizeAnalysisStatus(activeJob.status);
  summary.engine = activeJob.engine;
  summary.isCurrentEngine = activeJob.engine === AUDIO_ANALYSIS_ENGINE;
  summary.errorText = activeJob.errorText ?? null;
  summary.updatedAt = toIso(activeJob.endedAtMs ?? activeJob.startedAtMs ?? activeJob.createdAtMs);

  if (summary.status !== "completed") {
    return summary;
  }

  const findings = findingsByJobId.get(activeJob.id) ?? [];
  const classification = findings.find((row) => row.kind === "classification") ?? null;
  const classificationData = classification ? parseJsonRecord(classification.dataJson) : null;
  const broadClass = stringOrNull(classificationData?.class);

  summary.classification =
    broadClass === "speech" || broadClass === "music" || broadClass === "noise" || broadClass === "unknown"
      ? broadClass
      : null;
  summary.subclass = stringOrNull(classificationData?.subclass);
  summary.confidence = classification?.score ?? numberOrNull(classificationData?.confidence);
  summary.model = stringOrNull(classificationData?.model);
  summary.audioSeconds = numberOrNull(classificationData?.audioSeconds);
  summary.rms = numberOrNull(classificationData?.rms);
  summary.sceneLabel = stringOrNull(classificationData?.sceneLabel);
  summary.sceneConfidence = numberOrNull(classificationData?.sceneConfidence);
  summary.voiceDetected = booleanOrNull(classificationData?.voiceDetected);
  summary.voiceConfidence = numberOrNull(classificationData?.voiceConfidence);
  summary.voiceRatio = numberOrNull(classificationData?.voiceRatio);
  summary.voiceSeconds = numberOrNull(classificationData?.voiceSeconds);
  summary.voiceDetector = stringOrNull(classificationData?.voiceDetector);
  summary.explanation = stringOrNull(classificationData?.explanation);
  summary.topLabels = findings
    .filter((row) => row.kind === "top_label")
    .map((row) => ({
      label: stringOrNull(parseJsonRecord(row.dataJson)?.label) ?? "Unknown",
      score: row.score ?? 0,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  return summary;
}

function buildLocationSummary(
  locationRecord: JsonRecord | null,
  fallbackEvent: typeof activityEvents.$inferSelect | null,
): {
  label: string;
  source: string | null;
  sourceDetail: string | null;
  cityName: string | null;
  countryName: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
} {
  const catalogScope =
    locationRecord && typeof locationRecord.catalogScope === "object" && locationRecord.catalogScope
      ? (locationRecord.catalogScope as JsonRecord)
      : null;
  const resolvedPosition =
    locationRecord && typeof locationRecord.resolvedPosition === "object" && locationRecord.resolvedPosition
      ? (locationRecord.resolvedPosition as JsonRecord)
      : null;

  const cityName = stringOrNull(catalogScope?.cityName);
  const countryName = stringOrNull(catalogScope?.countryName);
  const countryCode = stringOrNull(catalogScope?.countryCode);
  const source = stringOrNull(locationRecord?.sourceMode)
    ?? stringOrNull(fallbackEvent?.locationSource ?? null);
  const sourceDetail = stringOrNull(locationRecord?.sourceDetail);
  const latitude = numberOrNull(resolvedPosition?.latitude)
    ?? numberOrNull(locationRecord?.locationLatitude)
    ?? fallbackEvent?.locationLatitude
    ?? null;
  const longitude = numberOrNull(resolvedPosition?.longitude)
    ?? numberOrNull(locationRecord?.locationLongitude)
    ?? fallbackEvent?.locationLongitude
    ?? null;

  let label = "No location context";
  if (cityName) {
    label = countryCode ? `${cityName}, ${countryCode}` : cityName;
  } else if (countryName) {
    label = countryName;
  } else if (latitude !== null && longitude !== null) {
    label = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  } else if (sourceDetail) {
    label = sourceDetail;
  }

  return {
    label,
    source,
    sourceDetail,
    cityName,
    countryName,
    countryCode,
    latitude,
    longitude,
  };
}

function buildCaptureFileSummary(row: typeof captureFiles.$inferSelect | null) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    kind: row.kind === "raw_iq" ? "raw_iq" : "audio",
    format: row.format,
    relativePath: row.relativePath,
    url: `/api/capture-files/${row.id}`,
  } as const;
}

function buildCaptureSummary(
  session: typeof captureSessions.$inferSelect,
  options: {
    event: typeof activityEvents.$inferSelect | null;
    review: typeof captureReviews.$inferSelect | null;
    audioFile: typeof captureFiles.$inferSelect | null;
    rawIqFile: typeof captureFiles.$inferSelect | null;
    tagCount: number;
    transcriptCount: number;
    analysisJobCount: number;
    analysisSummary: SigintAnalysisSummary;
  },
): SigintCaptureSummary {
  const sessionMetadata = parseJsonRecord(session.metadataJson);
  const locationRecord = parseJsonRecord(session.locationJson);
  const location = buildLocationSummary(locationRecord, options.event);
  const rf =
    sessionMetadata && typeof sessionMetadata.rf === "object" && sessionMetadata.rf
      ? (sessionMetadata.rf as JsonRecord)
      : null;

  return {
    id: session.id,
    activityEventId: session.activityEventId ?? null,
    module: session.module as SigintCaptureSummary["module"],
    mode:
      options.event?.mode === "scan" || options.event?.mode === "manual"
        ? options.event.mode
        : session.reason === "scan-hit"
          ? "scan"
          : "manual",
    reason: session.reason,
    label: options.event?.label ?? stringOrNull(sessionMetadata?.label) ?? `${session.module.toUpperCase()} capture`,
    freqMhz: session.freqHz === null ? null : session.freqHz / 1_000_000,
    demodMode: (session.demodMode as SigintCaptureSummary["demodMode"]) ?? null,
    startedAt: new Date(session.startedAtMs).toISOString(),
    endedAt: toIso(session.endedAtMs),
    durationMs:
      session.endedAtMs !== null
        ? Math.max(0, session.endedAtMs - session.startedAtMs)
        : options.event?.durationMs ?? null,
    reviewStatus: normalizeReviewStatus(options.review?.status),
    reviewPriority: normalizeReviewPriority(options.review?.priority),
    reviewNotes: options.review?.notes ?? "",
    reviewedAt: toIso(options.review?.reviewedAtMs),
    locationLabel: location.label,
    locationSource: location.source,
    locationSourceDetail: location.sourceDetail,
    cityName: location.cityName,
    countryName: location.countryName,
    countryCode: location.countryCode,
    resolvedLatitude: location.latitude,
    resolvedLongitude: location.longitude,
    deviceLabel: session.deviceLabel ?? stringOrNull((sessionMetadata?.device as JsonRecord | undefined)?.label) ?? null,
    deviceSerial: session.deviceSerial ?? stringOrNull((sessionMetadata?.device as JsonRecord | undefined)?.serial) ?? null,
    rmsAvg: options.event?.rmsAvg ?? null,
    rmsPeak: options.event?.rmsPeak ?? null,
    rfPeak: options.event?.rfPeak ?? null,
    squelch: numberOrNull(rf?.squelch) ?? options.event?.squelch ?? null,
    lna: numberOrNull(rf?.lna),
    vga: numberOrNull(rf?.vga),
    audioGain: numberOrNull(rf?.audioGain),
    audioCapture: buildCaptureFileSummary(options.audioFile),
    rawIqCapture: buildCaptureFileSummary(options.rawIqFile),
    tagCount: options.tagCount,
    transcriptCount: options.transcriptCount,
    analysisJobCount: options.analysisJobCount,
    analysisSummary: options.analysisSummary,
  };
}

function buildCaptureSearchText(item: SigintCaptureSummary): string {
  return [
    item.label,
    item.module,
    item.reason,
    item.locationLabel,
    item.cityName,
    item.countryName,
    item.countryCode,
    item.deviceLabel,
    item.deviceSerial,
    item.freqMhz === null ? null : item.freqMhz.toFixed(5),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesCaptureFilters(item: SigintCaptureSummary, filters: SigintCaptureListFilters): boolean {
  if (filters.module !== "all" && item.module !== filters.module) {
    return false;
  }
  if (filters.reviewStatus !== "all" && item.reviewStatus !== filters.reviewStatus) {
    return false;
  }
  if (filters.analysis !== "all") {
    if (filters.analysis === "queued" || filters.analysis === "running" || filters.analysis === "failed") {
      if (item.analysisSummary.status !== filters.analysis) {
        return false;
      }
    } else if (
      item.analysisSummary.status !== "completed"
      || item.analysisSummary.classification !== filters.analysis
    ) {
      return false;
    }
  }
  if (filters.hasAudio && !item.audioCapture) {
    return false;
  }
  if (filters.hasRawIq && !item.rawIqCapture) {
    return false;
  }
  if (filters.q) {
    const q = filters.q.trim().toLowerCase();
    if (q && !buildCaptureSearchText(item).includes(q)) {
      return false;
    }
  }

  return true;
}

function loadCaptureContext(
  sessions: Array<typeof captureSessions.$inferSelect>,
): {
  eventsById: Map<string, typeof activityEvents.$inferSelect>;
  reviewBySessionId: Map<string, typeof captureReviews.$inferSelect>;
  audioBySessionId: Map<string, typeof captureFiles.$inferSelect>;
  rawIqBySessionId: Map<string, typeof captureFiles.$inferSelect>;
  tagCountBySessionId: Map<string, number>;
  transcriptCountBySessionId: Map<string, number>;
  analysisJobCountBySessionId: Map<string, number>;
  analysisSummaryBySessionId: Map<string, SigintAnalysisSummary>;
} {
  if (sessions.length === 0) {
    return {
      eventsById: new Map(),
      reviewBySessionId: new Map(),
      audioBySessionId: new Map(),
      rawIqBySessionId: new Map(),
      tagCountBySessionId: new Map(),
      transcriptCountBySessionId: new Map(),
      analysisJobCountBySessionId: new Map(),
      analysisSummaryBySessionId: new Map(),
    };
  }

  const sessionIds = sessions.map((session) => session.id);
  const eventIds = sessions
    .map((session) => session.activityEventId)
    .filter((value): value is string => Boolean(value));

  const events = eventIds.length > 0
    ? appDb.select().from(activityEvents).where(inArray(activityEvents.id, eventIds)).all()
    : [];
  const reviews = appDb
    .select()
    .from(captureReviews)
    .where(inArray(captureReviews.captureSessionId, sessionIds))
    .all();
  const files = appDb
    .select()
    .from(captureFiles)
    .where(inArray(captureFiles.captureSessionId, sessionIds))
    .all();
  const tags = appDb
    .select()
    .from(captureTags)
    .where(inArray(captureTags.captureSessionId, sessionIds))
    .all();
  const transcripts = appDb
    .select()
    .from(captureTranscripts)
    .where(inArray(captureTranscripts.captureSessionId, sessionIds))
    .all();
  const jobs = appDb
    .select()
    .from(analysisJobs)
    .where(inArray(analysisJobs.captureSessionId, sessionIds))
    .all();
  const findings = jobs.length > 0
    ? appDb
      .select()
      .from(analysisFindings)
      .where(inArray(analysisFindings.analysisJobId, jobs.map((job) => job.id)))
      .all()
    : [];

  const eventsById = new Map(events.map((row) => [row.id, row]));
  const reviewBySessionId = new Map(reviews.map((row) => [row.captureSessionId, row]));
  const audioBySessionId = new Map<string, typeof captureFiles.$inferSelect>();
  const rawIqBySessionId = new Map<string, typeof captureFiles.$inferSelect>();
  for (const file of files) {
    if (file.kind === "audio" && !audioBySessionId.has(file.captureSessionId)) {
      audioBySessionId.set(file.captureSessionId, file);
    }
    if (file.kind === "raw_iq" && !rawIqBySessionId.has(file.captureSessionId)) {
      rawIqBySessionId.set(file.captureSessionId, file);
    }
  }

  const tagCountBySessionId = new Map<string, number>();
  for (const tag of tags) {
    tagCountBySessionId.set(tag.captureSessionId, (tagCountBySessionId.get(tag.captureSessionId) ?? 0) + 1);
  }

  const transcriptCountBySessionId = new Map<string, number>();
  for (const transcript of transcripts) {
    transcriptCountBySessionId.set(
      transcript.captureSessionId,
      (transcriptCountBySessionId.get(transcript.captureSessionId) ?? 0) + 1,
    );
  }

  const analysisJobCountBySessionId = new Map<string, number>();
  const jobsBySessionId = new Map<string, Array<typeof analysisJobs.$inferSelect>>();
  for (const job of jobs) {
    analysisJobCountBySessionId.set(
      job.captureSessionId,
      (analysisJobCountBySessionId.get(job.captureSessionId) ?? 0) + 1,
    );
    const current = jobsBySessionId.get(job.captureSessionId) ?? [];
    current.push(job);
    jobsBySessionId.set(job.captureSessionId, current);
  }

  const findingsByJobId = new Map<string, Array<typeof analysisFindings.$inferSelect>>();
  for (const finding of findings) {
    const current = findingsByJobId.get(finding.analysisJobId) ?? [];
    current.push(finding);
    findingsByJobId.set(finding.analysisJobId, current);
  }

  const analysisSummaryBySessionId = new Map<string, SigintAnalysisSummary>();
  for (const [sessionId, sessionJobs] of jobsBySessionId) {
    analysisSummaryBySessionId.set(sessionId, parseAnalysisSummary(sessionJobs, findingsByJobId));
  }

  return {
    eventsById,
    reviewBySessionId,
    audioBySessionId,
    rawIqBySessionId,
    tagCountBySessionId,
    transcriptCountBySessionId,
    analysisJobCountBySessionId,
    analysisSummaryBySessionId,
  };
}

export function listSigintCaptureSummaries(
  filters: SigintCaptureListFilters,
): SigintCaptureListResponse {
  const sessions = appDb
    .select()
    .from(captureSessions)
    .orderBy(desc(captureSessions.startedAtMs))
    .limit(Math.max(50, Math.min(filters.limit * 4, 800)))
    .all();
  const context = loadCaptureContext(sessions);

  const items = sessions
    .map((session) =>
      buildCaptureSummary(session, {
        event: session.activityEventId ? (context.eventsById.get(session.activityEventId) ?? null) : null,
        review: context.reviewBySessionId.get(session.id) ?? null,
        audioFile: context.audioBySessionId.get(session.id) ?? null,
        rawIqFile: context.rawIqBySessionId.get(session.id) ?? null,
        tagCount: context.tagCountBySessionId.get(session.id) ?? 0,
        transcriptCount: context.transcriptCountBySessionId.get(session.id) ?? 0,
        analysisJobCount: context.analysisJobCountBySessionId.get(session.id) ?? 0,
        analysisSummary: context.analysisSummaryBySessionId.get(session.id) ?? emptyAnalysisSummary(),
      }),
    )
    .filter((item) => matchesCaptureFilters(item, filters))
    .slice(0, Math.max(1, Math.min(filters.limit, 500)));

  return {
    items,
    counts: {
      total: items.length,
      pending: items.filter((item) => item.reviewStatus === "pending").length,
      kept: items.filter((item) => item.reviewStatus === "kept").length,
      discarded: items.filter((item) => item.reviewStatus === "discarded").length,
      flagged: items.filter((item) => item.reviewStatus === "flagged").length,
      withAudio: items.filter((item) => item.audioCapture).length,
      withRawIq: items.filter((item) => item.rawIqCapture).length,
    },
  };
}

export function getSigintCaptureDetail(captureSessionId: string): SigintCaptureDetail | null {
  const session = appDb
    .select()
    .from(captureSessions)
    .where(eq(captureSessions.id, captureSessionId))
    .limit(1)
    .get();

  if (!session) {
    return null;
  }

  const context = loadCaptureContext([session]);
  const review = context.reviewBySessionId.get(session.id) ?? null;
  const detail = buildCaptureSummary(session, {
    event: session.activityEventId ? (context.eventsById.get(session.activityEventId) ?? null) : null,
    review,
    audioFile: context.audioBySessionId.get(session.id) ?? null,
    rawIqFile: context.rawIqBySessionId.get(session.id) ?? null,
    tagCount: context.tagCountBySessionId.get(session.id) ?? 0,
    transcriptCount: context.transcriptCountBySessionId.get(session.id) ?? 0,
    analysisJobCount: context.analysisJobCountBySessionId.get(session.id) ?? 0,
    analysisSummary: context.analysisSummaryBySessionId.get(session.id) ?? emptyAnalysisSummary(),
  });

  const tags = appDb
    .select()
    .from(captureTags)
    .where(eq(captureTags.captureSessionId, session.id))
    .orderBy(desc(captureTags.createdAtMs))
    .all()
    .map((row) => ({
      id: row.id,
      tag: row.tag,
      source: row.source,
      score: row.score,
      createdAt: new Date(row.createdAtMs).toISOString(),
    }));

  const transcripts = appDb
    .select()
    .from(captureTranscripts)
    .where(eq(captureTranscripts.captureSessionId, session.id))
    .orderBy(desc(captureTranscripts.createdAtMs))
    .all()
    .map((row) => ({
      id: row.id,
      engine: row.engine,
      language: row.language,
      text: row.text,
      createdAt: new Date(row.createdAtMs).toISOString(),
    }));

  const jobs = appDb
    .select()
    .from(analysisJobs)
    .where(eq(analysisJobs.captureSessionId, session.id))
    .orderBy(desc(analysisJobs.createdAtMs))
    .all()
    .map((row) => ({
      id: row.id,
      engine: row.engine,
      status: row.status,
      errorText: row.errorText,
      createdAt: new Date(row.createdAtMs).toISOString(),
      startedAt: toIso(row.startedAtMs),
      endedAt: toIso(row.endedAtMs),
    }));

  return {
    ...detail,
    metadata: parseJsonRecord(session.metadataJson),
    location: parseJsonRecord(session.locationJson),
    tags,
    transcripts,
    analysisJobs: jobs,
  };
}

export function updateSigintCaptureReview(
  captureSessionId: string,
  input: SigintReviewUpdateInput,
): SigintCaptureDetail | null {
  const session = appDb
    .select({ id: captureSessions.id })
    .from(captureSessions)
    .where(eq(captureSessions.id, captureSessionId))
    .limit(1)
    .get();

  if (!session) {
    return null;
  }

  const nowMs = Date.now();
  appDb
    .insert(captureReviews)
    .values({
      captureSessionId,
      status: input.status,
      priority: input.priority,
      notes: input.notes.trim() || null,
      reviewedAtMs: nowMs,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    })
    .onConflictDoUpdate({
      target: captureReviews.captureSessionId,
      set: {
        status: input.status,
        priority: input.priority,
        notes: input.notes.trim() || null,
        reviewedAtMs: nowMs,
        updatedAtMs: nowMs,
      },
    })
    .run();

  return getSigintCaptureDetail(captureSessionId);
}

export function listSigintTrackSummaries(
  kind: SigintTrackKind,
  limit = 120,
): SigintTrackSummaryResponse {
  if (kind === "adsb") {
    const rows = sqliteDb
      .prepare(`
        WITH latest AS (
          SELECT
            hex,
            flight,
            type,
            source_label AS sourceLabel,
            latitude,
            longitude,
            COALESCE(seen_pos_at_ms, seen_at_ms) AS activityMs,
            ROW_NUMBER() OVER (
              PARTITION BY hex
              ORDER BY COALESCE(seen_pos_at_ms, seen_at_ms) DESC, created_at_ms DESC
            ) AS row_num
          FROM adsb_track_points
        ),
        counts AS (
          SELECT
            hex,
            COUNT(*) AS pointCount,
            MIN(seen_at_ms) AS firstSeenAtMs,
            MAX(COALESCE(seen_pos_at_ms, seen_at_ms)) AS lastSeenAtMs
          FROM adsb_track_points
          GROUP BY hex
        )
        SELECT
          latest.hex,
          latest.flight,
          latest.type,
          latest.sourceLabel,
          latest.latitude,
          latest.longitude,
          counts.pointCount,
          counts.firstSeenAtMs,
          counts.lastSeenAtMs
        FROM latest
        JOIN counts USING (hex)
        WHERE latest.row_num = 1
        ORDER BY counts.lastSeenAtMs DESC
        LIMIT ?
      `)
      .all(Math.max(1, Math.min(limit, 500))) as Array<{
        hex: string;
        flight: string | null;
        type: string | null;
        sourceLabel: string | null;
        latitude: number | null;
        longitude: number | null;
        pointCount: number;
        firstSeenAtMs: number | null;
        lastSeenAtMs: number | null;
      }>;

    return {
      kind,
      items: rows.map((row) => ({
        kind,
        key: row.hex,
        label: stringOrNull(row.flight) ?? row.hex,
        secondaryLabel: [stringOrNull(row.type), row.hex].filter(Boolean).join(" · "),
        sourceLabel: row.sourceLabel ?? "ADS-B",
        pointCount: row.pointCount,
        firstSeenAt: toIso(row.firstSeenAtMs),
        lastSeenAt: toIso(row.lastSeenAtMs),
        latitude: row.latitude,
        longitude: row.longitude,
      })),
    };
  }

  const rows = sqliteDb
    .prepare(`
      WITH latest AS (
        SELECT
          mmsi,
          name,
          callsign,
          ship_type AS shipType,
          source_label AS sourceLabel,
          latitude,
          longitude,
          ROW_NUMBER() OVER (
            PARTITION BY mmsi
            ORDER BY last_position_at_ms DESC, created_at_ms DESC
          ) AS row_num
        FROM ais_track_points
      ),
      counts AS (
        SELECT
          mmsi,
          COUNT(*) AS pointCount,
          MIN(last_position_at_ms) AS firstSeenAtMs,
          MAX(last_position_at_ms) AS lastSeenAtMs
        FROM ais_track_points
        GROUP BY mmsi
      )
      SELECT
        latest.mmsi,
        latest.name,
        latest.callsign,
        latest.shipType,
        latest.sourceLabel,
        latest.latitude,
        latest.longitude,
        counts.pointCount,
        counts.firstSeenAtMs,
        counts.lastSeenAtMs
      FROM latest
      JOIN counts USING (mmsi)
      WHERE latest.row_num = 1
      ORDER BY counts.lastSeenAtMs DESC
      LIMIT ?
    `)
    .all(Math.max(1, Math.min(limit, 500))) as Array<{
      mmsi: string;
      name: string | null;
      callsign: string | null;
      shipType: string | null;
      sourceLabel: string | null;
      latitude: number | null;
      longitude: number | null;
      pointCount: number;
      firstSeenAtMs: number | null;
      lastSeenAtMs: number | null;
    }>;

  return {
    kind,
    items: rows.map((row) => ({
      kind,
      key: row.mmsi,
      label: stringOrNull(row.name) ?? stringOrNull(row.callsign) ?? row.mmsi,
      secondaryLabel: [stringOrNull(row.shipType), row.mmsi].filter(Boolean).join(" · "),
      sourceLabel: row.sourceLabel ?? "AIS",
      pointCount: row.pointCount,
      firstSeenAt: toIso(row.firstSeenAtMs),
      lastSeenAt: toIso(row.lastSeenAtMs),
      latitude: row.latitude,
      longitude: row.longitude,
    })),
  };
}
