-- Master plan C1: scoped, expiring, revocable tokens for external AI agents.
-- An agent never holds management, approval, credential or network permissions; the
-- allowlist is enforced here as well as in code. A token can only narrow its creating
-- adult's current authority, so disabling or demoting the adult disables the agent.
INSERT INTO permissions(id) VALUES ('agent:connect') ON CONFLICT DO NOTHING;
INSERT INTO built_in_role_permissions(role_name,permission) VALUES ('org_admin','agent:connect') ON CONFLICT DO NOTHING;
CREATE POLICY c1_migration_discovery ON organizations FOR SELECT TO craftlayer_migrator USING(true);
DO $$ DECLARE org uuid; BEGIN
 FOR org IN SELECT id FROM organizations LOOP
  PERFORM set_config('app.organization_id',org::text,true);
  INSERT INTO role_permissions(organization_id,role_id,permission)
   SELECT org,r.id,'agent:connect' FROM roles r WHERE r.organization_id=org AND r.built_in AND r.name='org_admin' ON CONFLICT DO NOTHING;
 END LOOP;
 PERFORM set_config('app.organization_id','',true);
END $$;
DROP POLICY c1_migration_discovery ON organizations;
CREATE TABLE agent_tokens(
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organizations(id),
 membership_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 name varchar(60) NOT NULL CHECK(length(trim(name))>0),
 token_hash char(64) UNIQUE NOT NULL,
 permissions text[] NOT NULL CHECK(
  cardinality(permissions) BETWEEN 1 AND 16
  AND permissions <@ ARRAY['organization:read','project:read','environment:read','server:read','player:read','operation:read','node:read','event:read','mission:read','agent:read']::text[]
 ),
 project_id uuid NOT NULL,
 environment_id uuid,
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+interval '90 days'),
 last_used_at timestamptz CHECK(last_used_at IS NULL OR last_used_at>=created_at),
 revoked_at timestamptz,
 revoked_by uuid REFERENCES users(id),
 CHECK((revoked_at IS NULL)=(revoked_by IS NULL)),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES memberships(organization_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),
 FOREIGN KEY(organization_id,project_id,environment_id) REFERENCES environments(organization_id,project_id,id)
);
CREATE UNIQUE INDEX agent_tokens_active_name ON agent_tokens(organization_id,lower(name)) WHERE revoked_at IS NULL;
CREATE INDEX agent_tokens_membership ON agent_tokens(organization_id,membership_id);
-- Only an active adult member of the organization may own a token.
CREATE FUNCTION agent_tokens_creator() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=NEW.created_by AND account_type='adult' AND disabled_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.memberships WHERE organization_id=NEW.organization_id AND id=NEW.membership_id AND user_id=NEW.created_by AND disabled_at IS NULL)
 THEN RAISE EXCEPTION 'Agent tokens require an active adult member' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION agent_tokens_creator() FROM PUBLIC;
CREATE TRIGGER agent_tokens_creator BEFORE INSERT ON agent_tokens FOR EACH ROW EXECUTE FUNCTION agent_tokens_creator();
-- Scope, permissions, secret and expiry are immutable. Use time may only advance;
-- revocation happens once and is final. Rows are retained for audit; never deleted.
CREATE FUNCTION agent_tokens_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent tokens are retained; revoke instead' USING ERRCODE='23514'; END IF;
 IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.membership_id<>OLD.membership_id
    OR NEW.created_by<>OLD.created_by OR NEW.name<>OLD.name OR NEW.token_hash<>OLD.token_hash
    OR NEW.permissions<>OLD.permissions OR NEW.project_id<>OLD.project_id
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
REVOKE ALL ON FUNCTION agent_tokens_guard() FROM PUBLIC;
CREATE TRIGGER agent_tokens_guard BEFORE UPDATE OR DELETE ON agent_tokens FOR EACH ROW EXECUTE FUNCTION agent_tokens_guard();
ALTER TABLE agent_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON agent_tokens USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
-- Authentication looks a presented token up by its hash before any organization is known.
CREATE POLICY identity_token_lookup ON agent_tokens FOR SELECT TO craftlayer_identity USING(token_hash=nullif(current_setting('app.agent_token_hash',true),''));
GRANT SELECT,INSERT ON agent_tokens TO craftlayer_identity;
GRANT UPDATE(last_used_at,revoked_at,revoked_by) ON agent_tokens TO craftlayer_identity;
