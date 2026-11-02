-- A first provision command only; no automatic retry, lease takeover or lifecycle enqueue.
CREATE TABLE minecraft_deployment_jobs(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,node_id uuid NOT NULL,credential_version integer NOT NULL CHECK(credential_version>0),reservation_id uuid NOT NULL,intent_id uuid NOT NULL,
 actor_id uuid NOT NULL,session_id uuid NOT NULL,request_key uuid NOT NULL,request_hash char(64) NOT NULL,
 node_grant jsonb NOT NULL CHECK(jsonb_typeof(node_grant)='object' AND octet_length(node_grant::text)<=8192),
 server_grant jsonb NOT NULL CHECK(jsonb_typeof(server_grant)='object' AND octet_length(server_grant::text)<=8192),
 command jsonb NOT NULL CHECK(jsonb_typeof(command)='object' AND octet_length(command::text)<=8192),command_hash char(64) NOT NULL,stop_hash char(64) NOT NULL,
 lease_id uuid NOT NULL UNIQUE,attempt integer NOT NULL CHECK(attempt=1),fence integer NOT NULL CHECK(fence=1),
 state text NOT NULL CHECK(state IN ('issued','succeeded','rolled_back','not_dispatched','uncertain')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 receipt jsonb CHECK(receipt IS NULL OR (jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=8192)),created_at timestamptz NOT NULL,lease_expires_at timestamptz NOT NULL CHECK(lease_expires_at>created_at AND lease_expires_at<=created_at+interval '30 seconds'),
 UNIQUE(organization_id,id),UNIQUE(organization_id,node_id,credential_version,id),UNIQUE(organization_id,intent_id),UNIQUE(organization_id,reservation_id),UNIQUE(organization_id,actor_id,request_key),
 CHECK(request_hash ~ '^[a-f0-9]{64}$' AND command_hash ~ '^[a-f0-9]{64}$' AND stop_hash ~ '^[a-f0-9]{64}$'),
 CHECK((state='issued' AND receipt IS NULL) OR state='uncertain' OR receipt IS NOT NULL),
 FOREIGN KEY(organization_id,intent_id) REFERENCES minecraft_deployment_intents(organization_id,id),
 FOREIGN KEY(organization_id,project_id,environment_id,node_id,reservation_id) REFERENCES minecraft_reservations(organization_id,project_id,environment_id,node_id,id),
 FOREIGN KEY(organization_id,node_id,credential_version) REFERENCES minecraft_node_credentials(organization_id,node_id,version),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX minecraft_deployment_jobs_node ON minecraft_deployment_jobs(organization_id,node_id,lease_expires_at) WHERE state='issued';
CREATE INDEX minecraft_deployment_jobs_project ON minecraft_deployment_jobs(organization_id,project_id,created_at DESC);
CREATE FUNCTION minecraft_deployment_job_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE r minecraft_reservations; i minecraft_deployment_intents; p jsonb; BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['state','version','receipt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','receipt']) OR NEW.version<>OLD.version+1 OR OLD.receipt IS NOT NULL OR NOT ((OLD.state='issued' AND NEW.state IN ('succeeded','rolled_back','not_dispatched','uncertain')) OR (OLD.state='uncertain' AND NEW.state='uncertain' AND NEW.receipt IS NOT NULL)) THEN RAISE EXCEPTION 'Invalid deployment job transition' USING ERRCODE='23514'; END IF;
  IF NEW.receipt IS NOT NULL AND (NEW.receipt->'payload'->>'command_hash' IS DISTINCT FROM NEW.command_hash OR NEW.receipt->'payload'->>'operation_id' IS DISTINCT FROM NEW.id::text OR NEW.receipt->'payload'->>'purpose' IS DISTINCT FROM 'node.command.receipt.v1' OR (NEW.state<>'uncertain' AND NEW.receipt->'payload'->>'state' IS DISTINCT FROM NEW.state)) THEN RAISE EXCEPTION 'Invalid deployment receipt binding' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO r FROM minecraft_reservations WHERE organization_id=NEW.organization_id AND id=NEW.reservation_id FOR SHARE;
 SELECT * INTO i FROM minecraft_deployment_intents WHERE organization_id=NEW.organization_id AND id=NEW.intent_id;
 p=NEW.command->'payload';
 IF r.id IS NULL OR i.id IS NULL OR r.state<>'allocated' OR i.reservation_id<>r.id OR i.actor_id<>NEW.actor_id OR i.session_id<>NEW.session_id OR NEW.state<>'issued' OR NEW.receipt IS NOT NULL
 OR p->>'purpose' IS DISTINCT FROM 'node.command.v1' OR p->>'action' IS DISTINCT FROM 'provision' OR p->>'operation_id' IS DISTINCT FROM NEW.id::text
 OR p->>'organization_id' IS DISTINCT FROM NEW.organization_id::text OR p->>'project_id' IS DISTINCT FROM NEW.project_id::text OR p->>'node_id' IS DISTINCT FROM NEW.node_id::text
 OR p->>'reservation_id' IS DISTINCT FROM r.id::text OR p->>'deployment_id' IS DISTINCT FROM r.deployment_id::text OR p->>'server_id' IS DISTINCT FROM r.server_id::text OR p->>'world_id' IS DISTINCT FROM r.world_id::text
 OR p->>'plan_hash' IS DISTINCT FROM r.plan_hash OR p->>'template_hash' IS DISTINCT FROM r.template_hash OR p->>'policy_hash' IS DISTINCT FROM r.policy_hash
 OR NEW.credential_version<>r.credential_version OR p->>'credential_version' IS DISTINCT FROM r.credential_version::text OR p->>'fence' IS DISTINCT FROM '1' OR p->>'attempt' IS DISTINCT FROM '1'
 THEN RAISE EXCEPTION 'Invalid deployment job binding' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER minecraft_deployment_job_guard BEFORE INSERT OR UPDATE ON minecraft_deployment_jobs FOR EACH ROW EXECUTE FUNCTION minecraft_deployment_job_guard();
REVOKE ALL ON FUNCTION minecraft_deployment_job_guard() FROM PUBLIC;
CREATE TABLE minecraft_deployment_job_requests(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,node_id uuid NOT NULL,credential_version integer NOT NULL,job_id uuid NOT NULL,request_id uuid NOT NULL,permit_nonce uuid,
 kind text NOT NULL CHECK(kind IN ('fetch','permit')),request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL,
 UNIQUE(organization_id,node_id,credential_version,request_id),UNIQUE(organization_id,job_id,permit_nonce),
 CHECK((kind='fetch' AND permit_nonce IS NULL) OR (kind='permit' AND permit_nonce IS NOT NULL)),
 FOREIGN KEY(organization_id,node_id,credential_version,job_id) REFERENCES minecraft_deployment_jobs(organization_id,node_id,credential_version,id)
);
CREATE INDEX minecraft_deployment_job_requests_parent ON minecraft_deployment_job_requests(organization_id,job_id);
CREATE TABLE minecraft_deployment_job_outbox(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,job_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('issued','receipt','expired')),created_at timestamptz NOT NULL,schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
 FOREIGN KEY(organization_id,job_id) REFERENCES minecraft_deployment_jobs(organization_id,id)
);
CREATE INDEX minecraft_deployment_job_outbox_parent ON minecraft_deployment_job_outbox(organization_id,job_id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['minecraft_deployment_jobs','minecraft_deployment_job_requests','minecraft_deployment_job_outbox'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid)) WITH CHECK(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid))',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['minecraft_deployment_job_requests','minecraft_deployment_job_outbox'] LOOP EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION management_immutable()',t);END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON minecraft_deployment_jobs TO craftlayer_runtime;
GRANT SELECT,INSERT ON minecraft_deployment_job_requests,minecraft_deployment_job_outbox TO craftlayer_runtime;
