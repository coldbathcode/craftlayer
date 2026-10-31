-- Global identity is isolated behind a restricted identity-service role, not BYPASSRLS.
CREATE TABLE users (
 id uuid PRIMARY KEY, login varchar(64) UNIQUE NOT NULL CHECK(login=lower(login) AND login ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
 email varchar(254) UNIQUE CHECK(email IS NULL OR email=lower(email)),
 account_type text NOT NULL CHECK(account_type IN ('adult','child')),
 password_hash text NOT NULL, auth_version integer NOT NULL DEFAULT 1,
 disabled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE installation_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), bootstrap_hash char(64), recovery_hash char(64) NOT NULL,
 bootstrapped_at timestamptz, CHECK(bootstrapped_at IS NULL OR bootstrap_hash IS NULL)
);
CREATE TABLE instance_owners(user_id uuid PRIMARY KEY REFERENCES users(id));
CREATE TABLE sessions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), token_hash char(64) UNIQUE NOT NULL,
 auth_version integer NOT NULL, idle_expires_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE permissions(id text PRIMARY KEY);
CREATE TABLE built_in_role_permissions(role_name text NOT NULL,permission text NOT NULL REFERENCES permissions(id),PRIMARY KEY(role_name,permission));
CREATE TABLE memberships (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),user_id uuid NOT NULL REFERENCES users(id),
 auth_version integer NOT NULL DEFAULT 1, disabled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),UNIQUE(organization_id,user_id)
);
CREATE INDEX memberships_user ON memberships(user_id);
CREATE TABLE roles(id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),name varchar(80) NOT NULL,built_in boolean NOT NULL DEFAULT false,UNIQUE(organization_id,id),UNIQUE(organization_id,name));
CREATE TABLE role_permissions(organization_id uuid NOT NULL,role_id uuid NOT NULL,permission text NOT NULL REFERENCES permissions(id),PRIMARY KEY(organization_id,role_id,permission),FOREIGN KEY(organization_id,role_id) REFERENCES roles(organization_id,id),CHECK(permission NOT IN ('instance:manage','organization:create')));
CREATE TABLE membership_roles(organization_id uuid NOT NULL,membership_id uuid NOT NULL,role_id uuid NOT NULL,PRIMARY KEY(organization_id,membership_id,role_id),FOREIGN KEY(organization_id,membership_id) REFERENCES memberships(organization_id,id),FOREIGN KEY(organization_id,role_id) REFERENCES roles(organization_id,id));
CREATE TABLE environments(id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,name varchar(120) NOT NULL CHECK(length(trim(name))>0),type text NOT NULL CHECK(type IN ('minecraft','coding','research')),UNIQUE(organization_id,id),UNIQUE(organization_id,project_id,id),FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id));
CREATE TABLE resource_grants(id uuid PRIMARY KEY,organization_id uuid NOT NULL,membership_id uuid NOT NULL,permission text NOT NULL REFERENCES permissions(id),project_id uuid NOT NULL,environment_id uuid,FOREIGN KEY(organization_id,membership_id) REFERENCES memberships(organization_id,id),FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),FOREIGN KEY(organization_id,project_id,environment_id) REFERENCES environments(organization_id,project_id,id),UNIQUE NULLS NOT DISTINCT(organization_id,membership_id,permission,project_id,environment_id),CHECK(permission NOT IN ('instance:manage','organization:create')));
CREATE INDEX resource_grants_membership ON resource_grants(organization_id,membership_id);
CREATE TABLE invitations(id uuid PRIMARY KEY,organization_id uuid NOT NULL,role_id uuid NOT NULL,token_hash char(64) UNIQUE NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz,created_by uuid NOT NULL REFERENCES users(id),FOREIGN KEY(organization_id,role_id) REFERENCES roles(organization_id,id));
CREATE TABLE password_reset_tokens(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),token_hash char(64) UNIQUE NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz);
CREATE INDEX password_reset_user ON password_reset_tokens(user_id);
CREATE TABLE auth_rate_limits(bucket char(64) PRIMARY KEY,window_started_at timestamptz NOT NULL,attempts integer NOT NULL);
CREATE INDEX auth_rate_expiry ON auth_rate_limits(window_started_at);
CREATE TABLE audit_events(id bigserial PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),actor_id uuid REFERENCES users(id),action text NOT NULL,target_id text,outcome text NOT NULL CHECK(outcome IN ('allowed','denied')),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX audit_events_org_cursor ON audit_events(organization_id,id);
CREATE TABLE instance_audit_events(id bigserial PRIMARY KEY,actor_id uuid REFERENCES users(id),action text NOT NULL,target_id text,outcome text NOT NULL CHECK(outcome IN ('allowed','denied')),created_at timestamptz NOT NULL DEFAULT now());
-- Serialize owner lifecycle, including direct SQL writes by the identity role.
CREATE FUNCTION protect_last_owner() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.disabled_at IS NOT NULL AND OLD.disabled_at IS NULL THEN
  PERFORM pg_advisory_xact_lock(74618002);
  IF EXISTS(SELECT 1 FROM public.instance_owners WHERE user_id=OLD.id)
     AND NOT EXISTS(SELECT 1 FROM public.instance_owners o JOIN public.users u ON u.id=o.user_id WHERE u.disabled_at IS NULL AND u.id<>OLD.id)
  THEN RAISE EXCEPTION 'Last active instance owner cannot be disabled' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION protect_last_owner() FROM PUBLIC;
CREATE TRIGGER preserve_owner BEFORE UPDATE OF disabled_at ON users FOR EACH ROW EXECUTE FUNCTION protect_last_owner();
CREATE FUNCTION reject_child_owner() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=NEW.user_id AND account_type='adult' AND disabled_at IS NULL) THEN RAISE EXCEPTION 'Owner must be active adult' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION reject_child_owner() FROM PUBLIC;
CREATE TRIGGER active_adult_owner BEFORE INSERT ON instance_owners FOR EACH ROW EXECUTE FUNCTION reject_child_owner();
INSERT INTO permissions(id) VALUES ('organization:read'),('membership:manage'),('role:manage'),('user:invite'),('project:create'),('project:read'),('environment:admin'),('environment:read'),('provider:manage'),('budget:manage'),('mission:read'),('mission:create'),('mission:execute'),('mission:pause'),('mission:cancel'),('template:write'),('group:manage'),('agent:read'),('agent:assign'),('event:read'),('preset:launch'),('preset:approve'),('stop:request'),('stop:clear'),('approval:decide'),('coding:execute'),('research:execute'),('audit:read'),('instance:manage'),('organization:create') ON CONFLICT DO NOTHING;
INSERT INTO built_in_role_permissions(role_name,permission) VALUES ('org_admin','organization:read'),('org_admin','membership:manage'),('org_admin','role:manage'),('org_admin','user:invite'),('org_admin','project:create'),('org_admin','project:read'),('org_admin','environment:admin'),('org_admin','environment:read'),('org_admin','provider:manage'),('org_admin','budget:manage'),('org_admin','mission:read'),('org_admin','mission:create'),('org_admin','mission:execute'),('org_admin','mission:pause'),('org_admin','mission:cancel'),('org_admin','template:write'),('org_admin','group:manage'),('org_admin','agent:read'),('org_admin','agent:assign'),('org_admin','event:read'),('org_admin','preset:launch'),('org_admin','preset:approve'),('org_admin','stop:request'),('org_admin','stop:clear'),('org_admin','approval:decide'),('org_admin','coding:execute'),('org_admin','research:execute'),('org_admin','audit:read'),('operator','organization:read'),('operator','project:read'),('operator','environment:read'),('operator','mission:read'),('operator','mission:create'),('operator','mission:execute'),('operator','mission:pause'),('operator','mission:cancel'),('operator','group:manage'),('operator','agent:read'),('operator','agent:assign'),('operator','event:read'),('operator','preset:launch'),('operator','stop:request'),('builder','organization:read'),('builder','project:read'),('builder','environment:read'),('builder','mission:read'),('builder','agent:read'),('builder','event:read'),('builder','template:write'),('viewer','organization:read'),('viewer','project:read'),('viewer','environment:read'),('viewer','mission:read'),('viewer','agent:read'),('viewer','event:read'),('child','organization:read'),('child','project:read'),('child','environment:read'),('child','mission:read'),('child','agent:read'),('child','event:read'),('child','preset:launch'),('child','mission:pause'),('child','mission:cancel'),('child','stop:request') ON CONFLICT DO NOTHING;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON memberships USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON roles USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON role_permissions USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON membership_roles USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE environments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON environments USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE resource_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON resource_grants USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON invitations USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON audit_events USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
-- Only identity service can discover its authenticated user's memberships across orgs.
CREATE POLICY identity_own_memberships ON memberships FOR SELECT TO craftlayer_identity USING(user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON sessions,password_reset_tokens,auth_rate_limits TO craftlayer_identity;
GRANT SELECT,INSERT ON users,installation_settings,instance_owners TO craftlayer_identity;
GRANT UPDATE(password_hash,auth_version,disabled_at) ON users TO craftlayer_identity;
GRANT UPDATE(bootstrap_hash,bootstrapped_at) ON installation_settings TO craftlayer_identity;
GRANT SELECT ON permissions,built_in_role_permissions TO craftlayer_identity,craftlayer_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON organizations,projects,memberships,roles,role_permissions,membership_roles,environments,resource_grants,invitations TO craftlayer_identity;
GRANT SELECT,INSERT ON audit_events,instance_audit_events TO craftlayer_identity;
GRANT USAGE,SELECT ON SEQUENCE audit_events_id_seq,instance_audit_events_id_seq TO craftlayer_identity;
GRANT SELECT ON memberships,roles,role_permissions,membership_roles,environments,resource_grants TO craftlayer_runtime;
