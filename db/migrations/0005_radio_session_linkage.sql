ALTER TABLE activity_events ADD COLUMN radio_session_id TEXT;
ALTER TABLE activity_events ADD COLUMN stream_id TEXT;
CREATE INDEX IF NOT EXISTS activity_events_stream_started_idx
  ON activity_events (stream_id, started_at_ms);

ALTER TABLE capture_sessions ADD COLUMN radio_session_id TEXT;
ALTER TABLE capture_sessions ADD COLUMN stream_id TEXT;
CREATE INDEX IF NOT EXISTS capture_sessions_stream_started_idx
  ON capture_sessions (stream_id, started_at_ms);
