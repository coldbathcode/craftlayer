-- Public storage interface used by the provider ledger transaction, not a second open runtime transaction.
CREATE FUNCTION runtime_guard_provider_dispatch_v1(p_org uuid,p_mission uuid,p_task uuid,p_attempt uuid,p_request uuid,p_grant uuid,p_signature text,p_at timestamptz,p_authority_until timestamptz) RETURNS boolean
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
 AND m.state IN ('queued','running') AND a.lease_expires_at>checked_at AND a.deadline_at>checked_at AND m.deadline>checked_at
 AND m.execution_grant->>'id'=p_grant::text AND m.execution_grant->>'signature'=p_signature
 AND t.definition->'action'->>'kind'='fixture.model' AND w.protocol=1 AND w.revoked_at IS NULL AND w.expires_at>checked_at
 FOR UPDATE OF call;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE runtime_model_calls SET state='dispatched' WHERE organization_id=p_org AND attempt_id=p_attempt AND request_id=p_request;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION runtime_guard_provider_dispatch_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION runtime_guard_provider_dispatch_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz,timestamptz) TO craftlayer_runtime;
