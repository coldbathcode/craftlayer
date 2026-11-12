-- Master plan D1: a bound node takes the backup an occurrence asks for (ADR 0045).
-- Records which node an occurrence was handed to: set once, when it starts, so only
-- that node may report its result. Nothing here takes, copies or deletes a backup.
ALTER TABLE minecraft_backup_occurrences ADD COLUMN node_id uuid;
ALTER TABLE minecraft_backup_occurrences ADD CONSTRAINT minecraft_backup_occurrences_node FOREIGN KEY(organization_id,node_id) REFERENCES minecraft_nodes(organization_id,id);
ALTER TABLE minecraft_backup_occurrences ADD CONSTRAINT minecraft_backup_occurrences_node_started CHECK(node_id IS NULL OR started_at IS NOT NULL);
CREATE INDEX minecraft_backup_occurrences_node ON minecraft_backup_occurrences(organization_id,node_id) WHERE state='running';
CREATE OR REPLACE FUNCTION backup_occurrence_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Backup occurrences are retained' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.project_id,NEW.environment_id,NEW.server_id,NEW.policy_id,NEW.policy_revision,NEW.occurrence_key,NEW.kind,NEW.local_date,NEW.scheduled_at,NEW.offhost_copy,NEW.requested_by,NEW.operation_id,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.project_id,OLD.environment_id,OLD.server_id,OLD.policy_id,OLD.policy_revision,OLD.occurrence_key,OLD.kind,OLD.local_date,OLD.scheduled_at,OLD.offhost_copy,OLD.requested_by,OLD.operation_id,OLD.created_at)
 THEN RAISE EXCEPTION 'Backup occurrence identity is immutable' USING ERRCODE='23514'; END IF;
 IF NOT ((OLD.state='pending' AND NEW.state IN ('running','failed')) OR (OLD.state='running' AND NEW.state IN ('complete','failed')))
 THEN RAISE EXCEPTION 'Backup occurrence state only moves forward' USING ERRCODE='23514'; END IF;
 IF OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at THEN RAISE EXCEPTION 'Backup occurrence start is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.node_id IS DISTINCT FROM OLD.node_id AND NOT (OLD.state='pending' AND NEW.state='running' AND OLD.node_id IS NULL)
 THEN RAISE EXCEPTION 'The backup node is set once, when the backup starts' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION backup_occurrence_transition() FROM PUBLIC;
