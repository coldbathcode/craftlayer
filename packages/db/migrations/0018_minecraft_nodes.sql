-- Distinct read-only node principal; enrollment grants no Docker/game mutation.
INSERT INTO permissions(id) VALUES ('node:read'),('node:enroll'),('node:rotate'),('node:revoke');
INSERT INTO built_in_role_permissions(role_name,permission) SELECT 'org_admin',p FROM unnest(ARRAY['node:read','node:enroll','node:rotate','node:revoke']) p;
CREATE POLICY node_migration_discovery ON organizations FOR SELECT TO craftlayer_migrator USING(true);
DO $$ DECLARE org uuid; BEGIN
 FOR org IN SELECT id FROM organizations LOOP
  PERFORM set_config('app.organization_id',org::text,true);
  INSERT INTO role_permissions(organization_id,role_id,permission) SELECT org,r.id,p FROM roles r CROSS JOIN unnest(ARRAY['node:read','node:enroll','node:rotate','node:revoke']) p WHERE r.organization_id=org AND r.built_in AND r.name='org_admin' ON CONFLICT DO NOTHING;
 END LOOP; PERFORM set_config('app.organization_id','',true);
END $$;
DROP POLICY node_migration_discovery ON organizations;
CREATE TABLE minecraft_nodes(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,name varchar(80) NOT NULL CHECK(length(trim(name))>0),
 state text NOT NULL CHECK(state IN ('enrolling','active','revoked')),version integer NOT NULL DEFAULT 1 CHECK(version>0),credential_version integer NOT NULL DEFAULT 1 CHECK(credential_version>0),
 enrollment_expires_at timestamptz NOT NULL,last_sequence integer NOT NULL DEFAULT 0 CHECK(last_sequence>=0),last_seen_at timestamptz,
 capacity jsonb CHECK(capacity IS NULL OR octet_length(capacity::text)<=32768),enrolled_by uuid NOT NULL,created_at timestamptz NOT NULL,
 UNIQUE(organization_id,id),UNIQUE(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),
 FOREIGN KEY(organization_id,enrolled_by) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX minecraft_nodes_scope ON minecraft_nodes(organization_id,project_id,created_at DESC,id DESC);
CREATE INDEX minecraft_nodes_actor ON minecraft_nodes(organization_id,enrolled_by);
CREATE TABLE minecraft_node_credentials(
 organization_id uuid NOT NULL,node_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),public_key varchar(59) NOT NULL UNIQUE CHECK(public_key ~ '^[A-Za-z0-9_-]{59}$'),
 certificate_sha256 char(64) NOT NULL UNIQUE CHECK(certificate_sha256 ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours'),
 PRIMARY KEY(organization_id,node_id,version),FOREIGN KEY(organization_id,node_id) REFERENCES minecraft_nodes(organization_id,id)
);
CREATE TABLE minecraft_node_operations(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,node_id uuid NOT NULL,actor_id uuid NOT NULL,session_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('enroll','rotate','revoke')),request_key uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL,
 UNIQUE(organization_id,id),UNIQUE(organization_id,actor_id,kind,request_key),
 FOREIGN KEY(organization_id,project_id,node_id) REFERENCES minecraft_nodes(organization_id,project_id,id),FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX minecraft_node_operations_node ON minecraft_node_operations(organization_id,node_id,id);
CREATE INDEX minecraft_node_operations_recent ON minecraft_node_operations(organization_id,project_id,created_at DESC);
CREATE INDEX minecraft_node_operations_actor ON minecraft_node_operations(organization_id,actor_id);
CREATE TABLE minecraft_node_outbox(id uuid PRIMARY KEY,organization_id uuid NOT NULL,operation_id uuid NOT NULL,schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),created_at timestamptz NOT NULL,FOREIGN KEY(organization_id,operation_id) REFERENCES minecraft_node_operations(organization_id,id));
CREATE INDEX minecraft_node_outbox_operation ON minecraft_node_outbox(organization_id,operation_id);
CREATE TRIGGER minecraft_node_credentials_immutable BEFORE UPDATE OR DELETE ON minecraft_node_credentials FOR EACH ROW EXECUTE FUNCTION management_immutable();
CREATE TRIGGER minecraft_node_operations_immutable BEFORE UPDATE OR DELETE ON minecraft_node_operations FOR EACH ROW EXECUTE FUNCTION management_immutable();
CREATE TRIGGER minecraft_node_outbox_immutable BEFORE UPDATE OR DELETE ON minecraft_node_outbox FOR EACH ROW EXECUTE FUNCTION management_immutable();
CREATE FUNCTION node_transition() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.id,NEW.organization_id,NEW.project_id,NEW.name,NEW.enrolled_by,NEW.enrollment_expires_at,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.project_id,OLD.name,OLD.enrolled_by,OLD.enrollment_expires_at,OLD.created_at) OR OLD.state='revoked' OR NEW.version<OLD.version OR NEW.credential_version<OLD.credential_version OR (NEW.credential_version=OLD.credential_version AND NEW.last_sequence<OLD.last_sequence) OR NEW.credential_version>OLD.credential_version+1 OR (OLD.state='active' AND NEW.state='enrolling') THEN RAISE EXCEPTION 'Invalid node identity or transition' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER minecraft_node_transition BEFORE UPDATE ON minecraft_nodes FOR EACH ROW EXECUTE FUNCTION node_transition();
REVOKE ALL ON FUNCTION node_transition() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['minecraft_nodes','minecraft_node_credentials','minecraft_node_operations','minecraft_node_outbox'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid)) WITH CHECK(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid))',t);
 END LOOP; END $$;
GRANT SELECT,INSERT,UPDATE ON minecraft_nodes TO craftlayer_runtime;
GRANT SELECT,INSERT ON minecraft_node_credentials,minecraft_node_operations,minecraft_node_outbox TO craftlayer_runtime;
