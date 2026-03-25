ALTER TABLE adsb_track_points ADD COLUMN metadata_json TEXT;

ALTER TABLE ais_track_points ADD COLUMN message_type_code INTEGER;
ALTER TABLE ais_track_points ADD COLUMN channel_id TEXT;
ALTER TABLE ais_track_points ADD COLUMN phase INTEGER;
ALTER TABLE ais_track_points ADD COLUMN heading_deg REAL;
ALTER TABLE ais_track_points ADD COLUMN metadata_json TEXT;
