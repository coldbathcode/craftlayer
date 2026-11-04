-- Immutable review requests only. A request is neither a decision nor execution authority.
CREATE TABLE minecraft_deployment_approval_requests(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,node_id uuid NOT NULL,reservation_id uuid NOT NULL,intent_id uuid NOT NULL,actor_id uuid NOT NULL,session_id uuid NOT NULL,
 request_key uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),stop_hash char(64) NOT NULL CHECK(stop_hash ~ '^[a-f0-9]{64}$'),review_hash char(64) NOT NULL CHECK(review_hash ~ '^[a-f0-9]{64}$'),
 review jsonb NOT NULL CHECK(jsonb_typeof(review)='object' AND octet_length(review::text)<=8192),
 node_grant jsonb NOT NULL CHECK(jsonb_typeof(node_grant)='object' AND octet_length(node_grant::text)<=8192),server_grant jsonb NOT NULL CHECK(jsonb_typeof(server_grant)='object' AND octet_length(server_grant::text)<=8192),
 state text NOT NULL DEFAULT 'awaiting_review' CHECK(state='awaiting_review'),execution_enabled boolean NOT NULL DEFAULT false CHECK(NOT execution_enabled),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+interval '5 minutes'),
 UNIQUE(organization_id,id),UNIQUE(organization_id,intent_id),UNIQUE(organization_id,actor_id,request_key),
 FOREIGN KEY(organization_id,intent_id) REFERENCES minecraft_deployment_intents(organization_id,id),
 FOREIGN KEY(organization_id,project_id,environment_id,node_id,reservation_id) REFERENCES minecraft_reservations(organization_id,project_id,environment_id,node_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX minecraft_deployment_approval_requests_scope ON minecraft_deployment_approval_requests(organization_id,project_id,created_at DESC,id DESC);
CREATE FUNCTION minecraft_deployment_approval_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE i minecraft_deployment_intents; r minecraft_reservations; BEGIN
 SELECT * INTO i FROM minecraft_deployment_intents WHERE organization_id=NEW.organization_id AND id=NEW.intent_id;
 SELECT * INTO r FROM minecraft_reservations WHERE organization_id=NEW.organization_id AND id=NEW.reservation_id FOR SHARE;
 IF i.id IS NULL OR r.id IS NULL OR r.state<>'allocated' OR i.reservation_id<>r.id OR i.actor_id<>NEW.actor_id OR i.session_id<>NEW.session_id
 OR NEW.node_grant->>'organizationId' IS DISTINCT FROM NEW.organization_id::text OR NEW.server_grant->>'organizationId' IS DISTINCT FROM NEW.organization_id::text
 OR NEW.node_grant->>'userId' IS DISTINCT FROM NEW.actor_id::text OR NEW.server_grant->>'userId' IS DISTINCT FROM NEW.actor_id::text OR NEW.node_grant->>'sessionId' IS DISTINCT FROM NEW.session_id::text OR NEW.server_grant->>'sessionId' IS DISTINCT FROM NEW.session_id::text
 OR NEW.node_grant->>'permission' IS DISTINCT FROM 'node:deploy' OR NEW.node_grant->'resource'->>'kind' IS DISTINCT FROM 'project' OR NEW.node_grant->'resource'->>'id' IS DISTINCT FROM NEW.project_id::text
 OR NEW.server_grant->>'permission' IS DISTINCT FROM 'server:provision' OR NEW.server_grant->'resource'->>'kind' IS DISTINCT FROM 'environment' OR NEW.server_grant->'resource'->>'id' IS DISTINCT FROM NEW.environment_id::text
 OR EXISTS(SELECT 1 FROM minecraft_deployment_jobs WHERE organization_id=NEW.organization_id AND intent_id=i.id)
 OR NEW.review IS DISTINCT FROM jsonb_build_object(
 'schema_version',1,'project_id',r.project_id,'environment_id',r.environment_id,'node_id',r.node_id,'reservation_id',r.id,'deployment_id',r.deployment_id,'server_id',r.server_id,'world_id',r.world_id,'name',r.name,'template_id',r.template_id,'plan_hash',r.plan_hash,'policy_hash',r.policy_hash,'template_hash',r.template_hash,'node_version',r.node_version,'credential_version',r.credential_version,'reservation_version',r.version,'cpu_milli',r.cpu_milli,'memory_mb',r.memory_mb,'disk_mb',r.disk_mb,'java_port',r.java_port,'bedrock_port',r.bedrock_port)
 THEN RAISE EXCEPTION 'Invalid deployment review binding' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER minecraft_deployment_approval_request_guard BEFORE INSERT ON minecraft_deployment_approval_requests FOR EACH ROW EXECUTE FUNCTION minecraft_deployment_approval_request_guard();
REVOKE ALL ON FUNCTION minecraft_deployment_approval_request_guard() FROM PUBLIC;
CREATE TABLE minecraft_deployment_approval_request_outbox(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,request_id uuid NOT NULL,schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),created_at timestamptz NOT NULL,
 UNIQUE(organization_id,request_id),FOREIGN KEY(organization_id,request_id) REFERENCES minecraft_deployment_approval_requests(organization_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['minecraft_deployment_approval_requests','minecraft_deployment_approval_request_outbox'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid)) WITH CHECK(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid))',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION management_immutable()',t);
 END LOOP; END $$;
GRANT SELECT,INSERT ON minecraft_deployment_approval_requests,minecraft_deployment_approval_request_outbox TO craftlayer_runtime;
