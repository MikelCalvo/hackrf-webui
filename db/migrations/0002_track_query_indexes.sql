CREATE INDEX IF NOT EXISTS adsb_track_points_hex_position_idx
  ON adsb_track_points (hex, seen_pos_at_ms DESC, seen_at_ms DESC, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS ais_track_points_mmsi_position_idx
  ON ais_track_points (mmsi, last_position_at_ms DESC, last_seen_at_ms DESC, created_at_ms DESC);
