-- API-only sealed original authority intake; no control key or physical effects.
CREATE TABLE minecraft_deployment_authorizations(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,node_id uuid NOT NULL,reservation_id uuid NOT NULL,intent_id uuid NOT NULL,actor_id uuid NOT NULL,session_id uuid NOT NULL,
 request_key uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),stop_hash char(64) NOT NULL CHECK(stop_hash ~ '^[a-f0-9]{64}$'),
 node_grant jsonb NOT NULL CHECK(jsonb_typeof(node_grant)='object' AND octet_length(node_grant::text)<=8192),server_grant jsonb NOT NULL CHECK(jsonb_typeof(server_grant)='object' AND octet_length(server_grant::text)<=8192),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+interval '120 seconds'),
 UNIQUE(organization_id,id),UNIQUE(organization_id,intent_id),UNIQUE(organization_id,actor_id,request_key),
 FOREIGN KEY(organization_id,intent_id) REFERENCES minecraft_deployment_intents(organization_id,id),
 FOREIGN KEY(organization_id,project_id,environment_id,node_id,reservation_id) REFERENCES minecraft_reservations(organization_id,project_id,environment_id,node_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX minecraft_deployment_authorizations_node ON minecraft_deployment_authorizations(organization_id,node_id,expires_at);
CREATE INDEX minecraft_deployment_authorizations_actor ON minecraft_deployment_authorizations(organization_id,actor_id,created_at DESC);
CREATE INDEX minecraft_deployment_authorizations_project ON minecraft_deployment_authorizations(organization_id,project_id,created_at DESC);
CREATE FUNCTION minecraft_deployment_authorization_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE i minecraft_deployment_intents; r minecraft_reservations; BEGIN
 SELECT * INTO i FROM minecraft_deployment_intents WHERE organization_id=NEW.organization_id AND id=NEW.intent_id;
 SELECT * INTO r FROM minecraft_reservations WHERE organization_id=NEW.organization_id AND id=NEW.reservation_id FOR SHARE;
 IF i.id IS NULL OR r.id IS NULL OR r.state<>'allocated' OR i.reservation_id<>r.id OR i.actor_id<>NEW.actor_id OR i.session_id<>NEW.session_id OR NEW.node_grant->>'organizationId' IS DISTINCT FROM NEW.organization_id::text OR NEW.server_grant->>'organizationId' IS DISTINCT FROM NEW.organization_id::text
 OR NEW.node_grant->>'userId' IS DISTINCT FROM NEW.actor_id::text OR NEW.server_grant->>'userId' IS DISTINCT FROM NEW.actor_id::text OR NEW.node_grant->>'sessionId' IS DISTINCT FROM NEW.session_id::text OR NEW.server_grant->>'sessionId' IS DISTINCT FROM NEW.session_id::text
 OR NEW.node_grant->>'permission' IS DISTINCT FROM 'node:deploy' OR NEW.node_grant->'resource'->>'kind' IS DISTINCT FROM 'project' OR NEW.node_grant->'resource'->>'id' IS DISTINCT FROM NEW.project_id::text
 OR NEW.server_grant->>'permission' IS DISTINCT FROM 'server:provision' OR NEW.server_grant->'resource'->>'kind' IS DISTINCT FROM 'environment' OR NEW.server_grant->'resource'->>'id' IS DISTINCT FROM NEW.environment_id::text
 THEN RAISE EXCEPTION 'Invalid deployment authority binding' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER minecraft_deployment_authorization_guard BEFORE INSERT ON minecraft_deployment_authorizations FOR EACH ROW EXECUTE FUNCTION minecraft_deployment_authorization_guard();
REVOKE ALL ON FUNCTION minecraft_deployment_authorization_guard() FROM PUBLIC;
CREATE TABLE minecraft_deployment_authorization_outbox(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,authorization_id uuid NOT NULL,schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),created_at timestamptz NOT NULL,
 UNIQUE(organization_id,authorization_id),FOREIGN KEY(organization_id,authorization_id) REFERENCES minecraft_deployment_authorizations(organization_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['minecraft_deployment_authorizations','minecraft_deployment_authorization_outbox'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid)) WITH CHECK(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid))',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION management_immutable()',t);
 END LOOP; END $$;
GRANT SELECT,INSERT ON minecraft_deployment_authorizations,minecraft_deployment_authorization_outbox TO craftlayer_runtime;
ALTER TABLE minecraft_deployment_jobs ADD COLUMN authorization_id uuid;
ALTER TABLE minecraft_deployment_jobs ADD CONSTRAINT minecraft_deployment_jobs_authorization_unique UNIQUE(organization_id,authorization_id);
ALTER TABLE minecraft_deployment_jobs ADD CONSTRAINT minecraft_deployment_jobs_authority FOREIGN KEY(organization_id,authorization_id) REFERENCES minecraft_deployment_authorizations(organization_id,id);
CREATE FUNCTION minecraft_deployment_job_authority_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE a minecraft_deployment_authorizations; BEGIN
 IF NEW.authorization_id IS NULL THEN RETURN NEW; END IF;
 -- Authority rows are immutable; locking here would require forbidden runtime UPDATE privilege.
 SELECT * INTO a FROM minecraft_deployment_authorizations WHERE organization_id=NEW.organization_id AND id=NEW.authorization_id;
 IF a.id IS NULL OR a.intent_id<>NEW.intent_id OR a.actor_id<>NEW.actor_id OR a.session_id<>NEW.session_id OR a.request_hash<>NEW.request_hash OR a.stop_hash<>NEW.stop_hash OR a.node_grant<>NEW.node_grant OR a.server_grant<>NEW.server_grant OR a.expires_at<NEW.lease_expires_at OR NEW.request_key<>a.id THEN RAISE EXCEPTION 'Invalid authorized command binding' USING ERRCODE='23514'; END IF;RETURN NEW; END $$;
CREATE TRIGGER minecraft_deployment_job_authority_guard BEFORE INSERT ON minecraft_deployment_jobs FOR EACH ROW EXECUTE FUNCTION minecraft_deployment_job_authority_guard();
REVOKE ALL ON FUNCTION minecraft_deployment_job_authority_guard() FROM PUBLIC;
