ALTER TABLE capture_sessions ADD COLUMN device_label TEXT;
ALTER TABLE capture_sessions ADD COLUMN device_serial TEXT;

CREATE INDEX IF NOT EXISTS capture_sessions_activity_started_idx
  ON capture_sessions (activity_event_id, started_at_ms DESC);

CREATE TABLE IF NOT EXISTS capture_reviews (
  capture_session_id TEXT PRIMARY KEY NOT NULL REFERENCES capture_sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  notes TEXT,
  reviewed_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS capture_reviews_status_updated_idx
  ON capture_reviews (status, updated_at_ms DESC);

CREATE INDEX IF NOT EXISTS capture_reviews_priority_updated_idx
  ON capture_reviews (priority, updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS capture_tags (
  id TEXT PRIMARY KEY NOT NULL,
  capture_session_id TEXT NOT NULL REFERENCES capture_sessions(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  source TEXT NOT NULL,
  score REAL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS capture_tags_capture_source_idx
  ON capture_tags (capture_session_id, source);

CREATE INDEX IF NOT EXISTS capture_tags_tag_idx
  ON capture_tags (tag);

CREATE TABLE IF NOT EXISTS capture_transcripts (
  id TEXT PRIMARY KEY NOT NULL,
  capture_session_id TEXT NOT NULL REFERENCES capture_sessions(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  language TEXT,
  text TEXT NOT NULL,
  segments_json TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS capture_transcripts_capture_engine_idx
  ON capture_transcripts (capture_session_id, engine);
