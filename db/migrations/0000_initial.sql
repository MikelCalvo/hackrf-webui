CREATE TABLE IF NOT EXISTS scan_runs (
  id TEXT PRIMARY KEY NOT NULL,
  module TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  device_label TEXT,
  device_serial TEXT,
  config_json TEXT,
  location_json TEXT,
  notes TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS scan_runs_module_started_idx
  ON scan_runs (module, started_at_ms DESC);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY NOT NULL,
  scan_run_id TEXT REFERENCES scan_runs(id) ON DELETE SET NULL,
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
  region_id TEXT,
  country_id TEXT,
  city_id TEXT,
  location_source TEXT,
  location_latitude REAL,
  location_longitude REAL,
  metadata_json TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS activity_events_module_started_idx
  ON activity_events (module, started_at_ms DESC);

CREATE INDEX IF NOT EXISTS activity_events_freq_started_idx
  ON activity_events (freq_hz, started_at_ms DESC);

CREATE TABLE IF NOT EXISTS capture_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  scan_run_id TEXT REFERENCES scan_runs(id) ON DELETE SET NULL,
  activity_event_id TEXT REFERENCES activity_events(id) ON DELETE SET NULL,
  module TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  freq_hz INTEGER,
  center_freq_hz INTEGER,
  demod_mode TEXT,
  location_json TEXT,
  metadata_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS capture_sessions_started_idx
  ON capture_sessions (started_at_ms DESC);

CREATE INDEX IF NOT EXISTS capture_sessions_module_started_idx
  ON capture_sessions (module, started_at_ms DESC);

CREATE TABLE IF NOT EXISTS capture_files (
  id TEXT PRIMARY KEY NOT NULL,
  capture_session_id TEXT NOT NULL REFERENCES capture_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  format TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  byte_size INTEGER,
  sha256 TEXT,
  sample_rate INTEGER,
  created_at_ms INTEGER NOT NULL,
  metadata_json TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS capture_files_relative_path_idx
  ON capture_files (relative_path);

CREATE INDEX IF NOT EXISTS capture_files_session_kind_idx
  ON capture_files (capture_session_id, kind);

CREATE TABLE IF NOT EXISTS analysis_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  capture_session_id TEXT NOT NULL REFERENCES capture_sessions(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  status TEXT NOT NULL,
  params_json TEXT,
  error_text TEXT,
  started_at_ms INTEGER,
  ended_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS analysis_jobs_capture_status_idx
  ON analysis_jobs (capture_session_id, status);

CREATE TABLE IF NOT EXISTS analysis_findings (
  id TEXT PRIMARY KEY NOT NULL,
  analysis_job_id TEXT NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  score REAL,
  start_ms INTEGER,
  end_ms INTEGER,
  data_json TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS analysis_findings_job_kind_idx
  ON analysis_findings (analysis_job_id, kind);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS adsb_track_points (
  id TEXT PRIMARY KEY NOT NULL,
  observation_key TEXT NOT NULL,
  hex TEXT NOT NULL,
  flight TEXT,
  type TEXT,
  category TEXT,
  squawk TEXT,
  emergency TEXT,
  source_label TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  altitude_feet INTEGER,
  ground_speed_knots REAL,
  track_deg REAL,
  vertical_rate_fpm INTEGER,
  on_ground INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  rssi REAL,
  seen_at_ms INTEGER NOT NULL,
  seen_pos_at_ms INTEGER,
  generated_at_ms INTEGER,
  receiver_latitude REAL,
  receiver_longitude REAL,
  created_at_ms INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS adsb_track_points_observation_key_idx
  ON adsb_track_points (observation_key);

CREATE INDEX IF NOT EXISTS adsb_track_points_hex_seen_idx
  ON adsb_track_points (hex, seen_at_ms DESC);

CREATE TABLE IF NOT EXISTS ais_track_points (
  id TEXT PRIMARY KEY NOT NULL,
  observation_key TEXT NOT NULL,
  mmsi TEXT NOT NULL,
  name TEXT,
  callsign TEXT,
  imo TEXT,
  ship_type TEXT,
  destination TEXT,
  nav_status TEXT,
  message_type TEXT,
  source_label TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  speed_knots REAL,
  course_deg REAL,
  is_moving INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  last_position_at_ms INTEGER NOT NULL,
  last_static_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ais_track_points_observation_key_idx
  ON ais_track_points (observation_key);

CREATE INDEX IF NOT EXISTS ais_track_points_mmsi_seen_idx
  ON ais_track_points (mmsi, last_seen_at_ms DESC);
