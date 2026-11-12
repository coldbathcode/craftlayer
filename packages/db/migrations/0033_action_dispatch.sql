-- Master plan A2: a bound node executes typed server actions over the private transport.
-- Adds the server-to-node binding, records which node an action was dispatched to, and
-- lets an operator choose a node credential lifetime longer than one day (ADR 0044).
-- Nothing here performs an action.

-- The one-day ceiling suited a local fixture; a long-running private host needs an
-- operator-chosen lifetime. The client certificate's own expiry is still checked per request.
DO $$ DECLARE c text; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='minecraft_node_credentials'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%expires_at%' LOOP
  EXECUTE format('ALTER TABLE minecraft_node_credentials DROP CONSTRAINT %I',c);
 END LOOP;
END $$;
ALTER TABLE minecraft_node_credentials ADD CONSTRAINT minecraft_node_credentials_lifetime CHECK(expires_at>created_at AND expires_at<=created_at+interval '400 days');

-- One current node per server. History is retained; a binding is released, never deleted.
CREATE TABLE minecraft_server_nodes(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,server_id uuid NOT NULL,node_id uuid NOT NULL,
 bound_by uuid NOT NULL,created_at timestamptz NOT NULL,released_at timestamptz,released_by uuid,
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,project_id,environment_id,server_id) REFERENCES minecraft_servers(organization_id,project_id,environment_id,id),
 FOREIGN KEY(organization_id,project_id,node_id) REFERENCES minecraft_nodes(organization_id,project_id,id),
 FOREIGN KEY(organization_id,bound_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,released_by) REFERENCES memberships(organization_id,user_id),
 CHECK((released_at IS NULL)=(released_by IS NULL)),CHECK(released_at IS NULL OR released_at>=created_at)
);
CREATE UNIQUE INDEX minecraft_server_nodes_current ON minecraft_server_nodes(organization_id,server_id) WHERE released_at IS NULL;
CREATE INDEX minecraft_server_nodes_node ON minecraft_server_nodes(organization_id,node_id) WHERE released_at IS NULL;
CREATE FUNCTION server_node_binding_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Server node bindings are retained' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-ARRAY['released_at','released_by']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['released_at','released_by'])
 THEN RAISE EXCEPTION 'Server node binding identity is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.released_at IS NOT NULL THEN RAISE EXCEPTION 'A released binding stays released' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION server_node_binding_transition() FROM PUBLIC;
CREATE TRIGGER minecraft_server_nodes_transition BEFORE UPDATE OR DELETE ON minecraft_server_nodes FOR EACH ROW EXECUTE FUNCTION server_node_binding_transition();
ALTER TABLE minecraft_server_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE minecraft_server_nodes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON minecraft_server_nodes USING(organization_id=(SELECT nullif(current_setting('app.organization_id',true),'')::uuid)) WITH CHECK(organization_id=(SELECT nullif(current_setting('app.organization_id',true),'')::uuid));
GRANT SELECT,INSERT,UPDATE ON minecraft_server_nodes TO craftlayer_runtime;

-- Which node an action went to: set once at dispatch, so only that node may report its result.
ALTER TABLE minecraft_server_actions ADD COLUMN node_id uuid;
ALTER TABLE minecraft_server_actions ADD CONSTRAINT minecraft_server_actions_node FOREIGN KEY(organization_id,node_id) REFERENCES minecraft_nodes(organization_id,id);
ALTER TABLE minecraft_server_actions ADD CONSTRAINT minecraft_server_actions_node_dispatched CHECK(node_id IS NULL OR dispatched_at IS NOT NULL);
CREATE OR REPLACE FUNCTION server_action_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Server actions are retained' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','failure_code','evidence','version','dispatched_at','finished_at','node_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','failure_code','evidence','version','dispatched_at','finished_at','node_id'])
 THEN RAISE EXCEPTION 'Server action identity is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Server action version must advance by one' USING ERRCODE='23514'; END IF;
 IF NOT ((OLD.state='pending' AND NEW.state IN ('dispatched','expired','cancelled','failed')) OR (OLD.state='dispatched' AND NEW.state IN ('succeeded','failed','expired')))
 THEN RAISE EXCEPTION 'Server action state only moves forward' USING ERRCODE='23514'; END IF;
 IF OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at THEN RAISE EXCEPTION 'Dispatch time is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.node_id IS DISTINCT FROM OLD.node_id AND NOT (OLD.state='pending' AND NEW.state='dispatched' AND OLD.node_id IS NULL)
 THEN RAISE EXCEPTION 'The dispatch node is set once at dispatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION server_action_transition() FROM PUBLIC;
