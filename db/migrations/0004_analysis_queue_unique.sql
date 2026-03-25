CREATE UNIQUE INDEX IF NOT EXISTS analysis_jobs_capture_engine_idx
  ON analysis_jobs (capture_session_id, engine);
