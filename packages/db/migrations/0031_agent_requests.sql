-- Master plan C3: agents ask, adults approve. An agent token may carry a list of action
-- kinds it is allowed to *request*; a request becomes a real server action only when an
-- adult with the action's permission approves it. Agents never execute anything.
ALTER TABLE agent_tokens ADD COLUMN may_request text[] NOT NULL DEFAULT '{}' CHECK(
 cardinality(may_request)<=8
 AND may_request <@ ARRAY['allow_player','revoke_player','kick_player','say','save','start','stop','restart']::text[]
);
CREATE OR REPLACE FUNCTION agent_tokens_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent tokens are retained; revoke instead' USING ERRCODE='23514'; END IF;
 IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.membership_id<>OLD.membership_id
    OR NEW.created_by<>OLD.created_by OR NEW.name<>OLD.name OR NEW.token_hash<>OLD.token_hash
    OR NEW.permissions<>OLD.permissions OR NEW.may_request<>OLD.may_request OR NEW.project_id<>OLD.project_id
    OR NEW.environment_id IS DISTINCT FROM OLD.environment_id
    OR NEW.created_at<>OLD.created_at OR NEW.expires_at<>OLD.expires_at
 THEN RAISE EXCEPTION 'Agent token scope is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by)
 THEN RAISE EXCEPTION 'Agent token revocation is final' USING ERRCODE='23514'; END IF;
 IF NEW.last_used_at IS DISTINCT FROM OLD.last_used_at
    AND (NEW.last_used_at IS NULL OR (OLD.last_used_at IS NOT NULL AND NEW.last_used_at<OLD.last_used_at))
 THEN RAISE EXCEPTION 'Agent token use time cannot move backwards' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
GRANT SELECT ON agent_tokens TO craftlayer_runtime;
CREATE TABLE minecraft_agent_requests(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,server_id uuid NOT NULL,
 agent_id uuid NOT NULL,created_by uuid NOT NULL,request_key uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('allow_player','revoke_player','kick_player','say','save','start','stop','restart')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object' AND octet_length(request::text)<=4096),
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 reason varchar(280) NOT NULL DEFAULT '',
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','declined','cancelled','expired')),
 decided_by uuid,decided_at timestamptz,note varchar(280),action_id uuid,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours'),
 UNIQUE(organization_id,id),UNIQUE(organization_id,agent_id,request_key),UNIQUE(organization_id,action_id),
 FOREIGN KEY(organization_id,project_id,environment_id,server_id) REFERENCES minecraft_servers(organization_id,project_id,environment_id,id),
 FOREIGN KEY(organization_id,agent_id) REFERENCES agent_tokens(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,decided_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,action_id) REFERENCES minecraft_server_actions(organization_id,id),
 CHECK((state='pending')=(decided_at IS NULL)),
 CHECK((state IN ('approved','declined'))=(decided_by IS NOT NULL)),
 CHECK((state='approved')=(action_id IS NOT NULL))
);
CREATE INDEX minecraft_agent_requests_server ON minecraft_agent_requests(organization_id,server_id,created_at DESC,id);
CREATE INDEX minecraft_agent_requests_agent ON minecraft_agent_requests(organization_id,agent_id,created_at DESC);
CREATE INDEX minecraft_agent_requests_open ON minecraft_agent_requests(organization_id,server_id) WHERE state='pending';
CREATE FUNCTION agent_request_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent requests are retained' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','decided_by','decided_at','note','action_id','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','decided_by','decided_at','note','action_id','version'])
 THEN RAISE EXCEPTION 'Agent request identity is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.version<>OLD.version+1 OR OLD.state<>'pending' THEN RAISE EXCEPTION 'Agent request decisions are final' USING ERRCODE='23514'; END IF;
 -- The deciding adult must not be the agent's own creator acting through the agent: the
 -- service enforces a real session; here we at least require a decided_by for decisions.
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION agent_request_transition() FROM PUBLIC;
CREATE TRIGGER minecraft_agent_requests_transition BEFORE UPDATE OR DELETE ON minecraft_agent_requests FOR EACH ROW EXECUTE FUNCTION agent_request_transition();
CREATE FUNCTION agent_request_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.state<>'pending' OR NEW.version<>1 OR NEW.action_id IS NOT NULL THEN RAISE EXCEPTION 'Agent requests start pending' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_tokens t WHERE t.organization_id=NEW.organization_id AND t.id=NEW.agent_id AND t.revoked_at IS NULL AND t.expires_at>NEW.created_at AND NEW.kind=ANY(t.may_request) AND t.created_by=NEW.created_by)
 THEN RAISE EXCEPTION 'Agent token may not request this action' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION agent_request_insert() FROM PUBLIC;
CREATE TRIGGER minecraft_agent_requests_insert BEFORE INSERT ON minecraft_agent_requests FOR EACH ROW EXECUTE FUNCTION agent_request_insert();
CREATE TABLE minecraft_agent_request_outbox(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,request_id uuid NOT NULL,
 event text NOT NULL CHECK(event IN ('requested','approved','declined','cancelled','expired')),
 schema_version integer NOT NULL CHECK(schema_version=1),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,request_id) REFERENCES minecraft_agent_requests(organization_id,id)
);
CREATE INDEX minecraft_agent_request_outbox_request ON minecraft_agent_request_outbox(organization_id,request_id);
CREATE TRIGGER minecraft_agent_request_outbox_immutable BEFORE UPDATE OR DELETE ON minecraft_agent_request_outbox FOR EACH ROW EXECUTE FUNCTION management_immutable();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['minecraft_agent_requests','minecraft_agent_request_outbox'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid)) WITH CHECK(organization_id=(SELECT nullif(current_setting(''app.organization_id'',true),'''')::uuid))',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON minecraft_agent_requests TO craftlayer_runtime;
GRANT SELECT,INSERT ON minecraft_agent_request_outbox TO craftlayer_runtime;
