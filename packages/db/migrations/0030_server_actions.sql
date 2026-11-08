-- Master plan A3 (intake): typed server actions as durable, auditable requests.
-- An action row is a request a node will execute through the private game-control
-- channel; this migration stores and guards requests and their results. Nothing here
-- performs an action, and no node dispatch exists yet.
INSERT INTO permissions(id) VALUES ('player:manage'),('server:control') ON CONFLICT DO NOTHING;
INSERT INTO built_in_role_permissions(role_name,permission) VALUES
 ('org_admin','player:manage'),('org_admin','server:control') ON CONFLICT DO NOTHING;
CREATE POLICY a3_migration_discovery ON organizations FOR SELECT TO craftlayer_migrator USING(true);
DO $$ DECLARE org uuid; BEGIN
 FOR org IN SELECT id FROM organizations LOOP
  PERFORM set_config('app.organization_id',org::text,true);
  INSERT INTO role_permissions(organization_id,role_id,permission)
   SELECT org,r.id,p.permission FROM roles r JOIN built_in_role_permissions p ON p.role_name=r.name
   WHERE r.organization_id=org AND r.built_in AND p.permission IN ('player:manage','server:control') ON CONFLICT DO NOTHING;
 END LOOP;
 PERFORM set_config('app.organization_id','',true);
END $$;
DROP POLICY a3_migration_discovery ON organizations;
ALTER TABLE management_operations DROP CONSTRAINT management_operations_kind_check;
ALTER TABLE management_operations ADD CONSTRAINT management_operations_kind_check CHECK(kind IN ('adopt','observe','unregister','identity_enroll','backup_policy','backup_request','server_action'));
CREATE TABLE minecraft_server_actions(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,server_id uuid NOT NULL,
 operation_id uuid NOT NULL,actor_id uuid NOT NULL,session_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('allow_player','revoke_player','kick_player','say','save','start','stop','restart')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object' AND octet_length(request::text)<=4096),
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 fence integer NOT NULL CHECK(fence>0),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','dispatched','succeeded','failed','expired','cancelled')),
 failure_code text NOT NULL DEFAULT 'none' CHECK(failure_code IN ('none','node_unavailable','server_unreachable','refused_by_server','not_verified','expired','cancelled','interrupted')),
 evidence jsonb CHECK(evidence IS NULL OR (jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=4096)),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes'),
 dispatched_at timestamptz,finished_at timestamptz,
 UNIQUE(organization_id,id),UNIQUE(organization_id,operation_id),UNIQUE(organization_id,server_id,fence),
 FOREIGN KEY(organization_id,project_id,environment_id,server_id) REFERENCES minecraft_servers(organization_id,project_id,environment_id,id),
 FOREIGN KEY(organization_id,server_id,operation_id) REFERENCES management_operations(organization_id,server_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id),
 CHECK((state='pending' AND dispatched_at IS NULL AND finished_at IS NULL) OR (state='dispatched' AND dispatched_at IS NOT NULL AND finished_at IS NULL) OR (state IN ('succeeded','failed','expired','cancelled') AND finished_at IS NOT NULL)),
 CHECK(state<>'succeeded' OR (failure_code='none' AND evidence IS NOT NULL)),
 CHECK(state NOT IN ('failed','expired','cancelled') OR failure_code<>'none'),
 CHECK(state<>'expired' OR failure_code='expired'),CHECK(state<>'cancelled' OR failure_code='cancelled'),
 CHECK(dispatched_at IS NULL OR dispatched_at>=created_at),CHECK(finished_at IS NULL OR finished_at>=created_at)
);
CREATE INDEX minecraft_server_actions_server ON minecraft_server_actions(organization_id,server_id,created_at DESC,id);
CREATE INDEX minecraft_server_actions_open ON minecraft_server_actions(organization_id,server_id,fence) WHERE state IN ('pending','dispatched');
CREATE FUNCTION server_action_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Server actions are retained' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','failure_code','evidence','version','dispatched_at','finished_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','failure_code','evidence','version','dispatched_at','finished_at'])
 THEN RAISE EXCEPTION 'Server action identity is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Server action version must advance by one' USING ERRCODE='23514'; END IF;
 IF NOT ((OLD.state='pending' AND NEW.state IN ('dispatched','expired','cancelled','failed')) OR (OLD.state='dispatched' AND NEW.state IN ('succeeded','failed','expired')))
 THEN RAISE EXCEPTION 'Server action state only moves forward' USING ERRCODE='23514'; END IF;
 IF OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at THEN RAISE EXCEPTION 'Dispatch time is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION server_action_transition() FROM PUBLIC;
CREATE TRIGGER minecraft_server_actions_transition BEFORE UPDATE OR DELETE ON minecraft_server_actions FOR EACH ROW EXECUTE FUNCTION server_action_transition();
-- Fences are per server and strictly increasing so a node can refuse stale or replayed work.
CREATE FUNCTION server_action_fence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE last integer;
BEGIN
 SELECT max(fence) INTO last FROM public.minecraft_server_actions WHERE organization_id=NEW.organization_id AND server_id=NEW.server_id;
 IF NEW.fence<>coalesce(last,0)+1 THEN RAISE EXCEPTION 'Server action fence must be the next value' USING ERRCODE='23514'; END IF;
 IF NEW.state<>'pending' OR NEW.evidence IS NOT NULL OR NEW.version<>1 THEN RAISE EXCEPTION 'Server actions start pending' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION server_action_fence() FROM PUBLIC;
CREATE TRIGGER minecraft_server_actions_fence BEFORE INSERT ON minecraft_server_actions FOR EACH ROW EXECUTE FUNCTION server_action_fence();
CREATE TABLE minecraft_server_action_outbox(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,action_id uuid NOT NULL,
 event text NOT NULL CHECK(event IN ('requested','dispatched','finished','expired','cancelled')),
 schema_version integer NOT NULL CHECK(schema_version=1),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,action_id) REFERENCES minecraft_server_actions(organization_id,id)
);
CREATE INDEX minecraft_server_action_outbox_action ON minecraft_server_action_outbox(organization_id,action_id);
CREATE TRIGGER minecraft_server_action_outbox_immutable BEFORE UPDATE OR DELETE ON minecraft_server_action_outbox FOR EACH ROW EXECUTE FUNCTION management_immutable();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['minecraft_server_actions','minecraft_server_action_outbox'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid)) WITH CHECK(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid))',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON minecraft_server_actions TO craftlayer_runtime;
GRANT SELECT,INSERT ON minecraft_server_action_outbox TO craftlayer_runtime;
