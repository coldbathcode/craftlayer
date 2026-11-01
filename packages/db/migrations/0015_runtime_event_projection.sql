ALTER TABLE runtime_events ADD COLUMN aggregate_version integer NOT NULL DEFAULT 1 CHECK(aggregate_version>0);
CREATE INDEX runtime_events_mission_cursor ON runtime_events(organization_id,environment_id,mission_id,sequence);
