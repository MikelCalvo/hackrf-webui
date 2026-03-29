import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const scanRuns = sqliteTable(
  "scan_runs",
  {
    id: text("id").primaryKey(),
    module: text("module").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    startedAtMs: integer("started_at_ms").notNull(),
    endedAtMs: integer("ended_at_ms"),
    deviceLabel: text("device_label"),
    deviceSerial: text("device_serial"),
    configJson: text("config_json"),
    locationJson: text("location_json"),
    notes: text("notes"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => ({
    moduleStartedIdx: index("scan_runs_module_started_idx").on(table.module, table.startedAtMs),
  }),
);

export const activityEvents = sqliteTable(
  "activity_events",
  {
    id: text("id").primaryKey(),
    scanRunId: text("scan_run_id").references(() => scanRuns.id, { onDelete: "set null" }),
    module: text("module").notNull(),
    mode: text("mode").notNull(),
    label: text("label").notNull(),
    bandId: text("band_id"),
    channelId: text("channel_id"),
    channelNumber: integer("channel_number"),
    demodMode: text("demod_mode"),
    freqHz: integer("freq_hz").notNull(),
    centerFreqHz: integer("center_freq_hz"),
    startedAtMs: integer("started_at_ms").notNull(),
    endedAtMs: integer("ended_at_ms").notNull(),
    durationMs: integer("duration_ms"),
    rmsAvg: real("rms_avg"),
    rmsPeak: real("rms_peak"),
    rfPeak: real("rf_peak"),
    squelch: real("squelch"),
    regionId: text("region_id"),
    countryId: text("country_id"),
    cityId: text("city_id"),
    locationSource: text("location_source"),
    locationLatitude: real("location_latitude"),
    locationLongitude: real("location_longitude"),
    radioSessionId: text("radio_session_id"),
    streamId: text("stream_id"),
    metadataJson: text("metadata_json"),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => ({
    moduleStartedIdx: index("activity_events_module_started_idx").on(table.module, table.startedAtMs),
    freqStartedIdx: index("activity_events_freq_started_idx").on(table.freqHz, table.startedAtMs),
    streamStartedIdx: index("activity_events_stream_started_idx").on(table.streamId, table.startedAtMs),
  }),
);

export const burstEvents = sqliteTable(
  "burst_events",
  {
    id: text("id").primaryKey(),
    scanRunId: text("scan_run_id").references(() => scanRuns.id, { onDelete: "set null" }),
    activityEventId: text("activity_event_id").references(() => activityEvents.id, { onDelete: "set null" }),
    module: text("module").notNull(),
    mode: text("mode").notNull(),
    label: text("label").notNull(),
    bandId: text("band_id"),
    channelId: text("channel_id"),
    channelNumber: integer("channel_number"),
    demodMode: text("demod_mode"),
    freqHz: integer("freq_hz").notNull(),
    centerFreqHz: integer("center_freq_hz"),
    startedAtMs: integer("started_at_ms").notNull(),
    endedAtMs: integer("ended_at_ms").notNull(),
    durationMs: integer("duration_ms"),
    rmsAvg: real("rms_avg"),
    rmsPeak: real("rms_peak"),
    rfPeak: real("rf_peak"),
    squelch: real("squelch"),
    deviceLabel: text("device_label"),
    deviceSerial: text("device_serial"),
    locationJson: text("location_json"),
    radioSessionId: text("radio_session_id"),
    streamId: text("stream_id"),
    metadataJson: text("metadata_json"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => ({
    moduleStartedIdx: index("burst_events_module_started_idx").on(table.module, table.startedAtMs),
    freqStartedIdx: index("burst_events_freq_started_idx").on(table.freqHz, table.startedAtMs),
    activityStartedIdx: index("burst_events_activity_started_idx").on(table.activityEventId, table.startedAtMs),
    streamStartedIdx: index("burst_events_stream_started_idx").on(table.streamId, table.startedAtMs),
  }),
);

export const captureSessions = sqliteTable(
  "capture_sessions",
  {
    id: text("id").primaryKey(),
    scanRunId: text("scan_run_id").references(() => scanRuns.id, { onDelete: "set null" }),
    activityEventId: text("activity_event_id").references(() => activityEvents.id, { onDelete: "set null" }),
    burstEventId: text("burst_event_id").references(() => burstEvents.id, { onDelete: "set null" }),
    module: text("module").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull(),
    startedAtMs: integer("started_at_ms").notNull(),
    endedAtMs: integer("ended_at_ms"),
    freqHz: integer("freq_hz"),
    centerFreqHz: integer("center_freq_hz"),
    demodMode: text("demod_mode"),
    deviceLabel: text("device_label"),
    deviceSerial: text("device_serial"),
    locationJson: text("location_json"),
    radioSessionId: text("radio_session_id"),
    streamId: text("stream_id"),
    metadataJson: text("metadata_json"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => ({
    startedIdx: index("capture_sessions_started_idx").on(table.startedAtMs),
    moduleStartedIdx: index("capture_sessions_module_started_idx").on(table.module, table.startedAtMs),
    activityStartedIdx: index("capture_sessions_activity_started_idx").on(table.activityEventId, table.startedAtMs),
    burstStartedIdx: index("capture_sessions_burst_started_idx").on(table.burstEventId, table.startedAtMs),
    streamStartedIdx: index("capture_sessions_stream_started_idx").on(table.streamId, table.startedAtMs),
  }),
);

export const captureFiles = sqliteTable(
  "capture_files",
  {
    id: text("id").primaryKey(),
    captureSessionId: text("capture_session_id")
      .notNull()
      .references(() => captureSessions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    format: text("format").notNull(),
    relativePath: text("relative_path").notNull(),
    byteSize: integer("byte_size"),
    sha256: text("sha256"),
    sampleRate: integer("sample_rate"),
    createdAtMs: integer("created_at_ms").notNull(),
    metadataJson: text("metadata_json"),
  },
  (table) => ({
    relativePathIdx: uniqueIndex("capture_files_relative_path_idx").on(table.relativePath),
    sessionKindIdx: index("capture_files_session_kind_idx").on(table.captureSessionId, table.kind),
  }),
);

export const analysisJobs = sqliteTable(
  "analysis_jobs",
  {
    id: text("id").primaryKey(),
    captureSessionId: text("capture_session_id")
      .notNull()
      .references(() => captureSessions.id, { onDelete: "cascade" }),
    burstEventId: text("burst_event_id").references(() => burstEvents.id, { onDelete: "set null" }),
    engine: text("engine").notNull(),
    status: text("status").notNull(),
    paramsJson: text("params_json"),
    errorText: text("error_text"),
    startedAtMs: integer("started_at_ms"),
    endedAtMs: integer("ended_at_ms"),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => ({
    captureStatusIdx: index("analysis_jobs_capture_status_idx").on(table.captureSessionId, table.status),
    captureEngineIdx: uniqueIndex("analysis_jobs_capture_engine_idx").on(table.captureSessionId, table.engine),
    burstStatusIdx: index("analysis_jobs_burst_status_idx").on(table.burstEventId, table.status),
  }),
);

export const analysisFindings = sqliteTable(
  "analysis_findings",
  {
    id: text("id").primaryKey(),
    analysisJobId: text("analysis_job_id")
      .notNull()
      .references(() => analysisJobs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    score: real("score"),
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    dataJson: text("data_json"),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => ({
    jobKindIdx: index("analysis_findings_job_kind_idx").on(table.analysisJobId, table.kind),
  }),
);

export const captureReviews = sqliteTable(
  "capture_reviews",
  {
    captureSessionId: text("capture_session_id")
      .primaryKey()
      .references(() => captureSessions.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    priority: text("priority").notNull(),
    notes: text("notes"),
    reviewedAtMs: integer("reviewed_at_ms"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => ({
    statusUpdatedIdx: index("capture_reviews_status_updated_idx").on(table.status, table.updatedAtMs),
    priorityUpdatedIdx: index("capture_reviews_priority_updated_idx").on(table.priority, table.updatedAtMs),
  }),
);

export const captureTags = sqliteTable(
  "capture_tags",
  {
    id: text("id").primaryKey(),
    captureSessionId: text("capture_session_id")
      .notNull()
      .references(() => captureSessions.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    source: text("source").notNull(),
    score: real("score"),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => ({
    captureSourceIdx: index("capture_tags_capture_source_idx").on(table.captureSessionId, table.source),
    tagIdx: index("capture_tags_tag_idx").on(table.tag),
  }),
);

export const captureTranscripts = sqliteTable(
  "capture_transcripts",
  {
    id: text("id").primaryKey(),
    captureSessionId: text("capture_session_id")
      .notNull()
      .references(() => captureSessions.id, { onDelete: "cascade" }),
    engine: text("engine").notNull(),
    language: text("language"),
    text: text("text").notNull(),
    segmentsJson: text("segments_json"),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => ({
    captureEngineIdx: index("capture_transcripts_capture_engine_idx").on(table.captureSessionId, table.engine),
  }),
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAtMs: integer("updated_at_ms").notNull(),
});

export const adsbTrackPoints = sqliteTable(
  "adsb_track_points",
  {
    id: text("id").primaryKey(),
    observationKey: text("observation_key").notNull(),
    hex: text("hex").notNull(),
    flight: text("flight"),
    type: text("type"),
    category: text("category"),
    squawk: text("squawk"),
    emergency: text("emergency"),
    sourceLabel: text("source_label"),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    altitudeFeet: integer("altitude_feet"),
    groundSpeedKnots: real("ground_speed_knots"),
    trackDeg: real("track_deg"),
    verticalRateFpm: integer("vertical_rate_fpm"),
    onGround: integer("on_ground", { mode: "boolean" }).notNull(),
    messageCount: integer("message_count").notNull(),
    rssi: real("rssi"),
    seenAtMs: integer("seen_at_ms").notNull(),
    seenPosAtMs: integer("seen_pos_at_ms"),
    generatedAtMs: integer("generated_at_ms"),
    receiverLatitude: real("receiver_latitude"),
    receiverLongitude: real("receiver_longitude"),
    metadataJson: text("metadata_json"),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => ({
    observationKeyIdx: uniqueIndex("adsb_track_points_observation_key_idx").on(table.observationKey),
    hexSeenIdx: index("adsb_track_points_hex_seen_idx").on(table.hex, table.seenAtMs),
    hexPositionIdx: index("adsb_track_points_hex_position_idx").on(
      table.hex,
      table.seenPosAtMs,
      table.seenAtMs,
      table.createdAtMs,
    ),
  }),
);

export const aisTrackPoints = sqliteTable(
  "ais_track_points",
  {
    id: text("id").primaryKey(),
    observationKey: text("observation_key").notNull(),
    mmsi: text("mmsi").notNull(),
    name: text("name"),
    callsign: text("callsign"),
    imo: text("imo"),
    shipType: text("ship_type"),
    destination: text("destination"),
    navStatus: text("nav_status"),
    messageType: text("message_type"),
    messageTypeCode: integer("message_type_code"),
    sourceLabel: text("source_label"),
    channelId: text("channel_id"),
    phase: integer("phase"),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    speedKnots: real("speed_knots"),
    courseDeg: real("course_deg"),
    headingDeg: real("heading_deg"),
    isMoving: integer("is_moving", { mode: "boolean" }).notNull(),
    lastSeenAtMs: integer("last_seen_at_ms").notNull(),
    lastPositionAtMs: integer("last_position_at_ms").notNull(),
    lastStaticAtMs: integer("last_static_at_ms"),
    metadataJson: text("metadata_json"),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => ({
    observationKeyIdx: uniqueIndex("ais_track_points_observation_key_idx").on(table.observationKey),
    mmsiSeenIdx: index("ais_track_points_mmsi_seen_idx").on(table.mmsi, table.lastSeenAtMs),
    mmsiPositionIdx: index("ais_track_points_mmsi_position_idx").on(
      table.mmsi,
      table.lastPositionAtMs,
      table.lastSeenAtMs,
      table.createdAtMs,
    ),
  }),
);

export type ActivityEventRow = typeof activityEvents.$inferSelect;
export type BurstEventRow = typeof burstEvents.$inferSelect;
