ALTER TABLE runtime_missions ADD COLUMN cancel_requested_at timestamptz;
CREATE TABLE runtime_stop_latches(
 kind text NOT NULL CHECK(kind IN ('instance','organization','environment','mission')),scope_id uuid NOT NULL,organization_id uuid,
 epoch integer NOT NULL CHECK(epoch>0),latched boolean NOT NULL,operation_id uuid NOT NULL,reason varchar(240) NOT NULL,
 PRIMARY KEY(kind,scope_id),CHECK((kind='instance')=(organization_id IS NULL)),FOREIGN KEY(organization_id) REFERENCES organizations(id)
);
CREATE TABLE runtime_stop_operations(
 id uuid PRIMARY KEY,organization_id uuid,kind text NOT NULL CHECK(kind IN ('instance','organization','environment','mission')),scope_id uuid NOT NULL,
 epoch integer NOT NULL CHECK(epoch>0),reason varchar(240) NOT NULL,actor_id uuid,created_at timestamptz NOT NULL,cleared_at timestamptz,
 FOREIGN KEY(organization_id) REFERENCES organizations(id)
);
CREATE TABLE runtime_stop_targets(
 organization_id uuid NOT NULL,operation_id uuid NOT NULL REFERENCES runtime_stop_operations(id),attempt_id uuid NOT NULL,
 deadline_at timestamptz NOT NULL,acknowledged_at timestamptz,quiesced_at timestamptz,
 PRIMARY KEY(organization_id,operation_id,attempt_id),FOREIGN KEY(organization_id,attempt_id) REFERENCES runtime_attempts(organization_id,id)
);
ALTER TABLE runtime_stop_latches ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_stop_latches FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_stop_latches_scope ON runtime_stop_latches USING((kind='instance' AND current_setting('app.runtime_internal',true)='enabled') OR organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK((kind='instance' AND current_setting('app.runtime_internal',true)='enabled') OR organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE runtime_stop_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_stop_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_stop_operations_scope ON runtime_stop_operations USING((kind='instance' AND current_setting('app.runtime_internal',true)='enabled') OR organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK((kind='instance' AND current_setting('app.runtime_internal',true)='enabled') OR organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE runtime_stop_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_stop_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_stop_targets_scope ON runtime_stop_targets USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON runtime_stop_latches,runtime_stop_operations,runtime_stop_targets TO craftlayer_runtime;

-- Public storage interface used by the provider ledger transaction, not a second open runtime transaction.
CREATE OR REPLACE FUNCTION runtime_guard_provider_dispatch_v1(p_org uuid,p_mission uuid,p_task uuid,p_attempt uuid,p_request uuid,p_grant uuid,p_signature text,p_at timestamptz,p_authority_until timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE checked_at timestamptz;
BEGIN
 IF p_org IS DISTINCT FROM nullif(current_setting('app.organization_id',true),'')::uuid THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(74618006);
 checked_at:=greatest(p_at+greatest(clock_timestamp()-statement_timestamp(),interval '0 seconds'),clock_timestamp());
 IF checked_at>=p_authority_until THEN RETURN false; END IF;
 PERFORM 1 FROM runtime_model_calls call
 JOIN runtime_attempts a ON a.organization_id=call.organization_id AND a.id=call.attempt_id AND a.task_id=call.task_id AND a.mission_id=call.mission_id
 JOIN runtime_tasks t ON t.organization_id=a.organization_id AND t.id=a.task_id AND t.mission_id=a.mission_id
 JOIN runtime_missions m ON m.organization_id=a.organization_id AND m.id=a.mission_id
 JOIN runtime_workers w ON w.organization_id=a.organization_id AND w.id=a.worker_id AND w.environment_id=m.environment_id
 WHERE call.organization_id=p_org AND call.mission_id=p_mission AND call.task_id=p_task AND call.attempt_id=p_attempt AND call.request_id=p_request
 AND call.state IN ('prepared','dispatched') AND a.state='running' AND t.state='running' AND a.fence=t.fence AND a.generation=m.generation
 AND NOT EXISTS(SELECT 1 FROM runtime_stop_latches s WHERE s.latched AND ((s.kind='instance') OR (s.kind='organization' AND s.scope_id=m.organization_id) OR (s.kind='environment' AND s.scope_id=m.environment_id) OR (s.kind='mission' AND s.scope_id=m.id)))
 AND m.state IN ('queued','running') AND a.lease_expires_at>checked_at AND a.deadline_at>checked_at AND m.deadline>checked_at
 AND m.execution_grant->>'id'=p_grant::text AND m.execution_grant->>'signature'=p_signature
 AND t.definition->'action'->>'kind'='fixture.model' AND w.protocol=1 AND w.revoked_at IS NULL AND w.expires_at>checked_at
 FOR UPDATE OF call;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE runtime_model_calls SET state='dispatched' WHERE organization_id=p_org AND attempt_id=p_attempt AND request_id=p_request;
 RETURN true;
END $$;
CREATE FUNCTION runtime_stop_target_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM runtime_stop_operations o WHERE o.id=NEW.operation_id AND (o.organization_id IS NULL OR o.organization_id=NEW.organization_id)) THEN RAISE EXCEPTION 'Stop target scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER runtime_stop_target_scope BEFORE INSERT OR UPDATE ON runtime_stop_targets FOR EACH ROW EXECUTE FUNCTION runtime_stop_target_scope();
REVOKE ALL ON FUNCTION runtime_stop_target_scope() FROM PUBLIC;
