-- Immutable independent review decisions. A decision is evidence, never execution authority.
CREATE TABLE minecraft_deployment_approval_decisions(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,request_id uuid NOT NULL,reviewer_id uuid NOT NULL,reviewer_session_id uuid NOT NULL,
 request_key uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),review_hash char(64) NOT NULL CHECK(review_hash ~ '^[a-f0-9]{64}$'),stop_hash char(64) NOT NULL CHECK(stop_hash ~ '^[a-f0-9]{64}$'),decision_hash char(64) NOT NULL CHECK(decision_hash ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision IN('approved','rejected')),
 reviewer_approval_grant jsonb NOT NULL CHECK(jsonb_typeof(reviewer_approval_grant)='object' AND octet_length(reviewer_approval_grant::text)<=8192),
 reviewer_node_grant jsonb CHECK(reviewer_node_grant IS NULL OR (jsonb_typeof(reviewer_node_grant)='object' AND octet_length(reviewer_node_grant::text)<=8192)),
 reviewer_server_grant jsonb CHECK(reviewer_server_grant IS NULL OR (jsonb_typeof(reviewer_server_grant)='object' AND octet_length(reviewer_server_grant::text)<=8192)),
 execution_enabled boolean NOT NULL DEFAULT false CHECK(NOT execution_enabled),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+interval '5 minutes'),
 CHECK((decision='approved')=(reviewer_node_grant IS NOT NULL) AND (decision='approved')=(reviewer_server_grant IS NOT NULL)),
 UNIQUE(organization_id,id),UNIQUE(organization_id,request_id),UNIQUE(organization_id,reviewer_id,request_key),
 FOREIGN KEY(organization_id,request_id) REFERENCES minecraft_deployment_approval_requests(organization_id,id),
 FOREIGN KEY(organization_id,reviewer_id) REFERENCES memberships(organization_id,user_id)
);
CREATE FUNCTION minecraft_deployment_approval_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE q minecraft_deployment_approval_requests; r minecraft_reservations; BEGIN
 SELECT * INTO q FROM minecraft_deployment_approval_requests WHERE organization_id=NEW.organization_id AND id=NEW.request_id;
 SELECT * INTO r FROM minecraft_reservations WHERE organization_id=NEW.organization_id AND id=q.reservation_id FOR SHARE;
 IF q.id IS NULL OR r.id IS NULL OR NEW.reviewer_id=q.actor_id OR NEW.review_hash<>q.review_hash OR NEW.created_at>=q.expires_at OR NEW.expires_at>q.expires_at
 OR (NEW.decision='approved' AND (r.state<>'allocated' OR NEW.stop_hash<>q.stop_hash))
 OR EXISTS(SELECT 1 FROM minecraft_deployment_jobs WHERE organization_id=NEW.organization_id AND intent_id=q.intent_id)
 OR NEW.reviewer_approval_grant->>'organizationId' IS DISTINCT FROM NEW.organization_id::text OR NEW.reviewer_approval_grant->>'userId' IS DISTINCT FROM NEW.reviewer_id::text OR NEW.reviewer_approval_grant->>'sessionId' IS DISTINCT FROM NEW.reviewer_session_id::text
 OR NEW.reviewer_approval_grant->>'permission' IS DISTINCT FROM 'approval:decide' OR NEW.reviewer_approval_grant->'resource'->>'kind' IS DISTINCT FROM 'environment' OR NEW.reviewer_approval_grant->'resource'->>'id' IS DISTINCT FROM q.environment_id::text
 OR (NEW.decision='approved' AND (
  NEW.reviewer_node_grant->>'organizationId' IS DISTINCT FROM NEW.organization_id::text OR NEW.reviewer_server_grant->>'organizationId' IS DISTINCT FROM NEW.organization_id::text
  OR NEW.reviewer_node_grant->>'userId' IS DISTINCT FROM NEW.reviewer_id::text OR NEW.reviewer_server_grant->>'userId' IS DISTINCT FROM NEW.reviewer_id::text
  OR NEW.reviewer_node_grant->>'sessionId' IS DISTINCT FROM NEW.reviewer_session_id::text OR NEW.reviewer_server_grant->>'sessionId' IS DISTINCT FROM NEW.reviewer_session_id::text
  OR NEW.reviewer_node_grant->>'permission' IS DISTINCT FROM 'node:deploy' OR NEW.reviewer_node_grant->'resource'->>'kind' IS DISTINCT FROM 'project' OR NEW.reviewer_node_grant->'resource'->>'id' IS DISTINCT FROM q.project_id::text
  OR NEW.reviewer_server_grant->>'permission' IS DISTINCT FROM 'server:provision' OR NEW.reviewer_server_grant->'resource'->>'kind' IS DISTINCT FROM 'environment' OR NEW.reviewer_server_grant->'resource'->>'id' IS DISTINCT FROM q.environment_id::text))
 THEN RAISE EXCEPTION 'Invalid deployment decision binding' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER minecraft_deployment_approval_decision_guard BEFORE INSERT ON minecraft_deployment_approval_decisions FOR EACH ROW EXECUTE FUNCTION minecraft_deployment_approval_decision_guard();
REVOKE ALL ON FUNCTION minecraft_deployment_approval_decision_guard() FROM PUBLIC;
CREATE TABLE minecraft_deployment_approval_revocations(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,decision_id uuid NOT NULL,actor_id uuid NOT NULL,session_id uuid NOT NULL,
 request_key uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 approval_grant jsonb NOT NULL CHECK(jsonb_typeof(approval_grant)='object' AND octet_length(approval_grant::text)<=8192),created_at timestamptz NOT NULL,
 UNIQUE(organization_id,id),UNIQUE(organization_id,decision_id),UNIQUE(organization_id,actor_id,request_key),
 FOREIGN KEY(organization_id,decision_id) REFERENCES minecraft_deployment_approval_decisions(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE FUNCTION minecraft_deployment_approval_revocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE d minecraft_deployment_approval_decisions; q minecraft_deployment_approval_requests; BEGIN
 SELECT * INTO d FROM minecraft_deployment_approval_decisions WHERE organization_id=NEW.organization_id AND id=NEW.decision_id;
 SELECT * INTO q FROM minecraft_deployment_approval_requests WHERE organization_id=NEW.organization_id AND id=d.request_id;
 IF d.id IS NULL OR q.id IS NULL OR d.decision<>'approved'
 OR EXISTS(SELECT 1 FROM minecraft_deployment_jobs WHERE organization_id=NEW.organization_id AND intent_id=q.intent_id)
 OR NEW.approval_grant->>'organizationId' IS DISTINCT FROM NEW.organization_id::text OR NEW.approval_grant->>'userId' IS DISTINCT FROM NEW.actor_id::text OR NEW.approval_grant->>'sessionId' IS DISTINCT FROM NEW.session_id::text
 OR NEW.approval_grant->>'permission' IS DISTINCT FROM 'approval:decide' OR NEW.approval_grant->'resource'->>'kind' IS DISTINCT FROM 'environment' OR NEW.approval_grant->'resource'->>'id' IS DISTINCT FROM q.environment_id::text
 THEN RAISE EXCEPTION 'Invalid deployment revocation binding' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER minecraft_deployment_approval_revocation_guard BEFORE INSERT ON minecraft_deployment_approval_revocations FOR EACH ROW EXECUTE FUNCTION minecraft_deployment_approval_revocation_guard();
REVOKE ALL ON FUNCTION minecraft_deployment_approval_revocation_guard() FROM PUBLIC;
CREATE TABLE minecraft_deployment_approval_decision_outbox(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,decision_id uuid NOT NULL,event text NOT NULL CHECK(event IN('decided','revoked')),schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),created_at timestamptz NOT NULL,
 UNIQUE(organization_id,decision_id,event),FOREIGN KEY(organization_id,decision_id) REFERENCES minecraft_deployment_approval_decisions(organization_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['minecraft_deployment_approval_decisions','minecraft_deployment_approval_revocations','minecraft_deployment_approval_decision_outbox'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid)) WITH CHECK(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid))',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION management_immutable()',t);
 END LOOP; END $$;
GRANT SELECT,INSERT ON minecraft_deployment_approval_decisions,minecraft_deployment_approval_revocations,minecraft_deployment_approval_decision_outbox TO craftlayer_runtime;
