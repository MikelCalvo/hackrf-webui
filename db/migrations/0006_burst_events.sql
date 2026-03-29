CREATE TABLE IF NOT EXISTS burst_events (
  id TEXT PRIMARY KEY NOT NULL,
  scan_run_id TEXT REFERENCES scan_runs(id) ON DELETE SET NULL,
  activity_event_id TEXT REFERENCES activity_events(id) ON DELETE SET NULL,
  module TEXT NOT NULL,
  mode TEXT NOT NULL,
  label TEXT NOT NULL,
  band_id TEXT,
  channel_id TEXT,
  channel_number INTEGER,
  demod_mode TEXT,
  freq_hz INTEGER NOT NULL,
  center_freq_hz INTEGER,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER NOT NULL,
  duration_ms INTEGER,
  rms_avg REAL,
  rms_peak REAL,
  rf_peak REAL,
  squelch REAL,
  device_label TEXT,
  device_serial TEXT,
  location_json TEXT,
  radio_session_id TEXT,
  stream_id TEXT,
  metadata_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS burst_events_module_started_idx
  ON burst_events (module, started_at_ms DESC);

CREATE INDEX IF NOT EXISTS burst_events_freq_started_idx
  ON burst_events (freq_hz, started_at_ms DESC);

CREATE INDEX IF NOT EXISTS burst_events_activity_started_idx
  ON burst_events (activity_event_id, started_at_ms DESC);

CREATE INDEX IF NOT EXISTS burst_events_stream_started_idx
  ON burst_events (stream_id, started_at_ms DESC);

ALTER TABLE capture_sessions ADD COLUMN burst_event_id TEXT REFERENCES burst_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS capture_sessions_burst_started_idx
  ON capture_sessions (burst_event_id, started_at_ms DESC);

ALTER TABLE analysis_jobs ADD COLUMN burst_event_id TEXT REFERENCES burst_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS analysis_jobs_burst_status_idx
  ON analysis_jobs (burst_event_id, status);

INSERT INTO burst_events (
  id,
  scan_run_id,
  activity_event_id,
  module,
  mode,
  label,
  band_id,
  channel_id,
  channel_number,
  demod_mode,
  freq_hz,
  center_freq_hz,
  started_at_ms,
  ended_at_ms,
  duration_ms,
  rms_avg,
  rms_peak,
  rf_peak,
  squelch,
  device_label,
  device_serial,
  location_json,
  radio_session_id,
  stream_id,
  metadata_json,
  created_at_ms,
  updated_at_ms
)
SELECT
  cs.id,
  cs.scan_run_id,
  cs.activity_event_id,
  cs.module,
  COALESCE(ae.mode, CASE cs.reason WHEN 'scan-hit' THEN 'scan' ELSE 'manual' END),
  COALESCE(ae.label, UPPER(cs.module) || ' capture'),
  ae.band_id,
  ae.channel_id,
  ae.channel_number,
  COALESCE(cs.demod_mode, ae.demod_mode),
  COALESCE(cs.freq_hz, ae.freq_hz),
  COALESCE(cs.center_freq_hz, ae.center_freq_hz),
  cs.started_at_ms,
  COALESCE(cs.ended_at_ms, ae.ended_at_ms, cs.started_at_ms),
  CASE
    WHEN COALESCE(cs.ended_at_ms, ae.ended_at_ms) IS NULL THEN NULL
    ELSE MAX(0, COALESCE(cs.ended_at_ms, ae.ended_at_ms) - cs.started_at_ms)
  END,
  ae.rms_avg,
  ae.rms_peak,
  ae.rf_peak,
  ae.squelch,
  cs.device_label,
  cs.device_serial,
  cs.location_json,
  COALESCE(cs.radio_session_id, ae.radio_session_id),
  COALESCE(cs.stream_id, ae.stream_id),
  COALESCE(cs.metadata_json, ae.metadata_json),
  cs.created_at_ms,
  cs.updated_at_ms
FROM capture_sessions cs
LEFT JOIN activity_events ae
  ON ae.id = cs.activity_event_id
WHERE COALESCE(cs.freq_hz, ae.freq_hz) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM burst_events be
    WHERE be.id = cs.id
  );

UPDATE capture_sessions
SET burst_event_id = id
WHERE burst_event_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM burst_events be
    WHERE be.id = capture_sessions.id
  );

UPDATE analysis_jobs
SET burst_event_id = (
  SELECT cs.burst_event_id
  FROM capture_sessions cs
  WHERE cs.id = analysis_jobs.capture_session_id
)
WHERE burst_event_id IS NULL;
