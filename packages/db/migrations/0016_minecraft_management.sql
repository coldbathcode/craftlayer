-- F1: registry and captured observations only. No infrastructure command capability.
INSERT INTO permissions(id) VALUES ('server:read'),('server:adopt'),('server:observe'),('player:read'),('operation:read');
INSERT INTO built_in_role_permissions(role_name,permission) VALUES
 ('org_admin','server:read'),('org_admin','server:adopt'),('org_admin','server:observe'),('org_admin','player:read'),('org_admin','operation:read'),
 ('operator','server:read'),('operator','player:read'),('operator','operation:read'),
 ('viewer','server:read'),('viewer','player:read'),('viewer','operation:read');
-- A transaction-local migration-only discovery policy is removed before commit.
CREATE POLICY f1_migration_discovery ON organizations FOR SELECT TO craftlayer_migrator USING(true);
DO $$ DECLARE org uuid; BEGIN
 FOR org IN SELECT id FROM organizations LOOP
  PERFORM set_config('app.organization_id',org::text,true);
  INSERT INTO role_permissions(organization_id,role_id,permission)
   SELECT org,r.id,p.permission FROM roles r JOIN built_in_role_permissions p ON p.role_name=r.name
   WHERE r.organization_id=org AND r.built_in AND p.permission IN ('server:read','server:adopt','server:observe','player:read','operation:read') ON CONFLICT DO NOTHING;
 END LOOP;
 PERFORM set_config('app.organization_id','',true);
END $$;
DROP POLICY f1_migration_discovery ON organizations;
CREATE TABLE minecraft_servers(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,
 name varchar(100) NOT NULL CHECK(length(trim(name))>0),target_id varchar(64) NOT NULL CHECK(target_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
 binding_hash char(64) NOT NULL CHECK(binding_hash ~ '^[a-f0-9]{64}$'),
 registered boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1 CHECK(version>0),observation_fence integer NOT NULL DEFAULT 0 CHECK(observation_fence>=0),
 observation jsonb CHECK(observation IS NULL OR octet_length(observation::text)<=32768),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),UNIQUE(organization_id,project_id,environment_id,id),
 UNIQUE(organization_id,environment_id,target_id),UNIQUE(organization_id,environment_id,binding_hash),
 FOREIGN KEY(organization_id,project_id,environment_id) REFERENCES environments(organization_id,project_id,id)
);
CREATE INDEX minecraft_servers_scope ON minecraft_servers(organization_id,environment_id,id);
CREATE TABLE management_operations(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,server_id uuid NOT NULL,
 actor_id uuid NOT NULL,session_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('adopt','observe','unregister')),
 request_key uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('running','succeeded','failed')),failure_code text NOT NULL DEFAULT 'none' CHECK(failure_code IN ('none','source_unavailable','authority_changed','interrupted')),
 fence integer NOT NULL CHECK(fence>=0),deadline timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 UNIQUE(organization_id,id),UNIQUE(organization_id,actor_id,kind,request_key),
 FOREIGN KEY(organization_id,project_id,environment_id,server_id) REFERENCES minecraft_servers(organization_id,project_id,environment_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id),
 CHECK((state='running' AND finished_at IS NULL) OR (state<>'running' AND finished_at IS NOT NULL)),CHECK(state<>'succeeded' OR failure_code='none')
);
CREATE INDEX management_operations_scope ON management_operations(organization_id,environment_id,server_id,created_at DESC,id);
CREATE INDEX management_operations_actor ON management_operations(organization_id,actor_id);
CREATE INDEX management_operations_session ON management_operations(session_id);
CREATE TABLE management_outbox(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,operation_id uuid NOT NULL,schema_version integer NOT NULL CHECK(schema_version=1),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,operation_id) REFERENCES management_operations(organization_id,id)
);
CREATE INDEX management_outbox_operation ON management_outbox(organization_id,operation_id);
CREATE FUNCTION management_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable management record' USING ERRCODE='23514'; END $$;
CREATE TRIGGER management_outbox_immutable BEFORE UPDATE OR DELETE ON management_outbox FOR EACH ROW EXECUTE FUNCTION management_immutable();
CREATE FUNCTION management_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='minecraft_servers' THEN
  IF (NEW.id,NEW.organization_id,NEW.project_id,NEW.environment_id,NEW.target_id,NEW.binding_hash) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.project_id,OLD.environment_id,OLD.target_id,OLD.binding_hash) OR NEW.version<OLD.version OR NEW.observation_fence<OLD.observation_fence THEN RAISE EXCEPTION 'Immutable server binding or regressed fence' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.state<>'running' OR (NEW.id,NEW.organization_id,NEW.project_id,NEW.environment_id,NEW.server_id,NEW.actor_id,NEW.session_id,NEW.kind,NEW.request_key,NEW.request_hash,NEW.fence,NEW.deadline,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.project_id,OLD.environment_id,OLD.server_id,OLD.actor_id,OLD.session_id,OLD.kind,OLD.request_key,OLD.request_hash,OLD.fence,OLD.deadline,OLD.created_at) THEN RAISE EXCEPTION 'Immutable operation identity or terminal state' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER minecraft_server_binding BEFORE UPDATE ON minecraft_servers FOR EACH ROW EXECUTE FUNCTION management_transition();
CREATE TRIGGER management_operation_state BEFORE UPDATE ON management_operations FOR EACH ROW EXECUTE FUNCTION management_transition();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['minecraft_servers','management_operations','management_outbox'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid)) WITH CHECK(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid))',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON minecraft_servers,management_operations TO craftlayer_runtime;
GRANT SELECT,INSERT ON management_outbox TO craftlayer_runtime;
GRANT SELECT,INSERT ON audit_events TO craftlayer_runtime;
GRANT USAGE,SELECT ON SEQUENCE audit_events_id_seq TO craftlayer_runtime;
REVOKE ALL ON FUNCTION management_immutable(),management_transition() FROM PUBLIC;
