-- Master plan D1 / CL-F2-03 checkpoint B: durable backup policy revisions, schedule
-- occurrences and backup records. Records only: nothing here saves, archives, copies,
-- restores or deletes anything. Effects arrive later through the node agent and must
-- write their evidence into these rows.
INSERT INTO permissions(id) VALUES ('backup:read'),('backup:manage') ON CONFLICT DO NOTHING;
INSERT INTO built_in_role_permissions(role_name,permission) VALUES
 ('org_admin','backup:read'),('org_admin','backup:manage'),
 ('operator','backup:read'),('viewer','backup:read') ON CONFLICT DO NOTHING;
CREATE POLICY d1_migration_discovery ON organizations FOR SELECT TO craftlayer_migrator USING(true);
DO $$ DECLARE org uuid; BEGIN
 FOR org IN SELECT id FROM organizations LOOP
  PERFORM set_config('app.organization_id',org::text,true);
  INSERT INTO role_permissions(organization_id,role_id,permission)
   SELECT org,r.id,p.permission FROM roles r JOIN built_in_role_permissions p ON p.role_name=r.name
   WHERE r.organization_id=org AND r.built_in AND p.permission IN ('backup:read','backup:manage') ON CONFLICT DO NOTHING;
 END LOOP;
 PERFORM set_config('app.organization_id','',true);
END $$;
DROP POLICY d1_migration_discovery ON organizations;
-- Agents may read backup state; they still cannot request, hold, restore or delete.
ALTER TABLE agent_tokens DROP CONSTRAINT agent_tokens_permissions_check;
ALTER TABLE agent_tokens ADD CONSTRAINT agent_tokens_permissions_check CHECK(
 cardinality(permissions) BETWEEN 1 AND 16
 AND permissions <@ ARRAY['organization:read','project:read','environment:read','server:read','player:read','operation:read','node:read','event:read','mission:read','agent:read','backup:read']::text[]
);
ALTER TABLE management_operations DROP CONSTRAINT management_operations_kind_check;
ALTER TABLE management_operations ADD CONSTRAINT management_operations_kind_check CHECK(kind IN ('adopt','observe','unregister','identity_enroll','backup_policy','backup_request'));
-- Policy revisions are append-only. policy_id stays constant across revisions so a
-- logical daily occurrence keeps one identity however often the policy is edited.
CREATE TABLE minecraft_backup_policies(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,server_id uuid NOT NULL,
 policy_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),
 timezone varchar(64) NOT NULL CHECK(length(trim(timezone))>0),
 local_time char(5) NOT NULL CHECK(local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 retention_days integer NOT NULL CHECK(retention_days BETWEEN 14 AND 3650),
 offhost_weekday integer NOT NULL CHECK(offhost_weekday BETWEEN 0 AND 6),
 enabled boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL,operation_id uuid NOT NULL,created_at timestamptz NOT NULL,
 UNIQUE(organization_id,id),UNIQUE(organization_id,server_id,revision),UNIQUE(organization_id,operation_id),
 FOREIGN KEY(organization_id,project_id,environment_id,server_id) REFERENCES minecraft_servers(organization_id,project_id,environment_id,id),
 FOREIGN KEY(organization_id,server_id,operation_id) REFERENCES management_operations(organization_id,server_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX minecraft_backup_policies_server ON minecraft_backup_policies(organization_id,server_id,revision DESC);
CREATE FUNCTION backup_policy_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE prior public.minecraft_backup_policies%ROWTYPE;
BEGIN
 SELECT * INTO prior FROM public.minecraft_backup_policies WHERE organization_id=NEW.organization_id AND server_id=NEW.server_id ORDER BY revision DESC LIMIT 1;
 IF prior.id IS NULL THEN
  IF NEW.revision<>1 OR NEW.policy_id<>NEW.id THEN RAISE EXCEPTION 'First backup policy revision must be 1 with its own policy_id' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.revision<>prior.revision+1 OR NEW.policy_id<>prior.policy_id OR NEW.created_at<prior.created_at THEN RAISE EXCEPTION 'Backup policy revisions are sequential and keep their policy_id' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION backup_policy_revision() FROM PUBLIC;
CREATE TRIGGER minecraft_backup_policies_revision BEFORE INSERT ON minecraft_backup_policies FOR EACH ROW EXECUTE FUNCTION backup_policy_revision();
CREATE TRIGGER minecraft_backup_policies_immutable BEFORE UPDATE OR DELETE ON minecraft_backup_policies FOR EACH ROW EXECUTE FUNCTION management_immutable();
-- One occurrence per logical backup: the key is the occurrence hash for scheduled runs
-- and a hash of the request operation for manual runs. The key is the idempotency key.
CREATE TABLE minecraft_backup_occurrences(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,server_id uuid NOT NULL,
 policy_id uuid NOT NULL,policy_revision integer NOT NULL CHECK(policy_revision>0),
 occurrence_key char(64) NOT NULL CHECK(occurrence_key ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK(kind IN ('scheduled','manual')),
 local_date date,scheduled_at timestamptz NOT NULL,offhost_copy boolean NOT NULL DEFAULT false,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','complete','failed')),
 failure_code text NOT NULL DEFAULT 'none' CHECK(failure_code IN ('none','node_unavailable','save_failed','archive_failed','verification_failed','cancelled','interrupted')),
 requested_by uuid,operation_id uuid,
 created_at timestamptz NOT NULL,started_at timestamptz,finished_at timestamptz,
 UNIQUE(organization_id,id),UNIQUE(organization_id,server_id,occurrence_key),
 FOREIGN KEY(organization_id,project_id,environment_id,server_id) REFERENCES minecraft_servers(organization_id,project_id,environment_id,id),
 FOREIGN KEY(organization_id,server_id,operation_id) REFERENCES management_operations(organization_id,server_id,id),
 FOREIGN KEY(organization_id,requested_by) REFERENCES memberships(organization_id,user_id),
 CHECK((kind='scheduled' AND local_date IS NOT NULL AND requested_by IS NULL AND operation_id IS NULL) OR (kind='manual' AND local_date IS NULL AND requested_by IS NOT NULL AND operation_id IS NOT NULL)),
 CHECK((state='pending' AND started_at IS NULL AND finished_at IS NULL) OR (state='running' AND started_at IS NOT NULL AND finished_at IS NULL) OR (state IN ('complete','failed') AND finished_at IS NOT NULL)),
 CHECK(state<>'complete' OR failure_code='none'),CHECK(state<>'failed' OR failure_code<>'none'),
 CHECK(started_at IS NULL OR started_at>=created_at),CHECK(finished_at IS NULL OR finished_at>=created_at)
);
CREATE INDEX minecraft_backup_occurrences_server ON minecraft_backup_occurrences(organization_id,server_id,created_at DESC,id);
CREATE INDEX minecraft_backup_occurrences_open ON minecraft_backup_occurrences(organization_id,server_id) WHERE state IN ('pending','running');
CREATE FUNCTION backup_occurrence_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Backup occurrences are retained' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.project_id,NEW.environment_id,NEW.server_id,NEW.policy_id,NEW.policy_revision,NEW.occurrence_key,NEW.kind,NEW.local_date,NEW.scheduled_at,NEW.offhost_copy,NEW.requested_by,NEW.operation_id,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.project_id,OLD.environment_id,OLD.server_id,OLD.policy_id,OLD.policy_revision,OLD.occurrence_key,OLD.kind,OLD.local_date,OLD.scheduled_at,OLD.offhost_copy,OLD.requested_by,OLD.operation_id,OLD.created_at)
 THEN RAISE EXCEPTION 'Backup occurrence identity is immutable' USING ERRCODE='23514'; END IF;
 IF NOT ((OLD.state='pending' AND NEW.state IN ('running','failed')) OR (OLD.state='running' AND NEW.state IN ('complete','failed')))
 THEN RAISE EXCEPTION 'Backup occurrence state only moves forward' USING ERRCODE='23514'; END IF;
 IF OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at THEN RAISE EXCEPTION 'Backup occurrence start is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION backup_occurrence_transition() FROM PUBLIC;
CREATE TRIGGER minecraft_backup_occurrences_transition BEFORE UPDATE OR DELETE ON minecraft_backup_occurrences FOR EACH ROW EXECUTE FUNCTION backup_occurrence_transition();
-- One backup record per occurrence. Evidence timestamps are set once and never cleared;
-- a legal hold may change but only with its author recorded.
CREATE TABLE minecraft_backups(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,server_id uuid NOT NULL,
 occurrence_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete','failed')),
 archive_sha256 char(64) CHECK(archive_sha256 IS NULL OR archive_sha256 ~ '^[a-f0-9]{64}$'),
 size_bytes bigint CHECK(size_bytes IS NULL OR size_bytes>=0),
 manifest_hash char(64) CHECK(manifest_hash IS NULL OR manifest_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL,completed_at timestamptz,
 verified_at timestamptz,offhost_verified_at timestamptz,restore_tested_at timestamptz,
 legal_hold boolean NOT NULL DEFAULT false,legal_hold_changed_by uuid,legal_hold_changed_at timestamptz,
 UNIQUE(organization_id,id),UNIQUE(organization_id,occurrence_id),
 FOREIGN KEY(organization_id,project_id,environment_id,server_id) REFERENCES minecraft_servers(organization_id,project_id,environment_id,id),
 FOREIGN KEY(organization_id,occurrence_id) REFERENCES minecraft_backup_occurrences(organization_id,id),
 FOREIGN KEY(organization_id,legal_hold_changed_by) REFERENCES memberships(organization_id,user_id),
 CHECK((state='complete')=(archive_sha256 IS NOT NULL AND size_bytes IS NOT NULL AND manifest_hash IS NOT NULL AND completed_at IS NOT NULL)),
 CHECK(state='complete' OR (verified_at IS NULL AND offhost_verified_at IS NULL AND restore_tested_at IS NULL)),
 CHECK((legal_hold_changed_by IS NULL)=(legal_hold_changed_at IS NULL)),
 CHECK(legal_hold=false OR legal_hold_changed_by IS NOT NULL)
);
CREATE INDEX minecraft_backups_server ON minecraft_backups(organization_id,server_id,created_at DESC,id);
CREATE FUNCTION backup_record_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Backup records are retained; expire through the audited retention effect' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.project_id,NEW.environment_id,NEW.server_id,NEW.occurrence_id,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.project_id,OLD.environment_id,OLD.server_id,OLD.occurrence_id,OLD.created_at)
 THEN RAISE EXCEPTION 'Backup record identity is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.state<>NEW.state AND NOT (OLD.state='pending' AND NEW.state IN ('complete','failed'))
 THEN RAISE EXCEPTION 'Backup record state only moves forward' USING ERRCODE='23514'; END IF;
 IF OLD.state='complete' AND (NEW.archive_sha256,NEW.size_bytes,NEW.manifest_hash,NEW.completed_at) IS DISTINCT FROM (OLD.archive_sha256,OLD.size_bytes,OLD.manifest_hash,OLD.completed_at)
 THEN RAISE EXCEPTION 'Backup archive evidence is immutable' USING ERRCODE='23514'; END IF;
 IF (OLD.verified_at IS NOT NULL AND NEW.verified_at IS DISTINCT FROM OLD.verified_at)
    OR (OLD.offhost_verified_at IS NOT NULL AND NEW.offhost_verified_at IS DISTINCT FROM OLD.offhost_verified_at)
    OR (OLD.restore_tested_at IS NOT NULL AND NEW.restore_tested_at IS DISTINCT FROM OLD.restore_tested_at)
 THEN RAISE EXCEPTION 'Backup verification evidence is set once' USING ERRCODE='23514'; END IF;
 IF NEW.legal_hold<>OLD.legal_hold AND (NEW.legal_hold_changed_by IS NULL OR NEW.legal_hold_changed_at IS NULL)
 THEN RAISE EXCEPTION 'Legal hold changes record who and when' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION backup_record_transition() FROM PUBLIC;
CREATE TRIGGER minecraft_backups_transition BEFORE UPDATE OR DELETE ON minecraft_backups FOR EACH ROW EXECUTE FUNCTION backup_record_transition();
CREATE TABLE minecraft_backup_outbox(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,occurrence_id uuid NOT NULL,
 event text NOT NULL CHECK(event IN ('occurrence_due','occurrence_requested','backup_recorded','backup_failed','legal_hold_changed')),
 schema_version integer NOT NULL CHECK(schema_version=1),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,occurrence_id) REFERENCES minecraft_backup_occurrences(organization_id,id)
);
CREATE INDEX minecraft_backup_outbox_occurrence ON minecraft_backup_outbox(organization_id,occurrence_id);
CREATE TRIGGER minecraft_backup_outbox_immutable BEFORE UPDATE OR DELETE ON minecraft_backup_outbox FOR EACH ROW EXECUTE FUNCTION management_immutable();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['minecraft_backup_policies','minecraft_backup_occurrences','minecraft_backups','minecraft_backup_outbox'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid)) WITH CHECK(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid))',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT ON minecraft_backup_policies,minecraft_backup_outbox TO craftlayer_runtime;
GRANT SELECT,INSERT,UPDATE ON minecraft_backup_occurrences,minecraft_backups TO craftlayer_runtime;
