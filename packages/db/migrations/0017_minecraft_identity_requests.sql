-- F2 checkpoint: durable pending requests only; no verified identity or access grant.
INSERT INTO permissions(id) VALUES ('player:enroll');
INSERT INTO built_in_role_permissions(role_name,permission) VALUES ('org_admin','player:enroll');
CREATE POLICY f2_migration_discovery ON organizations FOR SELECT TO craftlayer_migrator USING(true);
DO $$ DECLARE org uuid; BEGIN
 FOR org IN SELECT id FROM organizations LOOP
  PERFORM set_config('app.organization_id',org::text,true);
  INSERT INTO role_permissions(organization_id,role_id,permission)
   SELECT org,r.id,'player:enroll' FROM roles r WHERE r.organization_id=org AND r.built_in AND r.name='org_admin' ON CONFLICT DO NOTHING;
 END LOOP;
 PERFORM set_config('app.organization_id','',true);
END $$;
DROP POLICY f2_migration_discovery ON organizations;
ALTER TABLE management_operations DROP CONSTRAINT management_operations_kind_check;
ALTER TABLE management_operations ADD CONSTRAINT management_operations_kind_check CHECK(kind IN ('adopt','observe','unregister','identity_enroll'));
ALTER TABLE management_operations ADD CONSTRAINT management_operation_server_unique UNIQUE(organization_id,server_id,id);
CREATE TABLE minecraft_identity_enrollments(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,server_id uuid NOT NULL,
 requested_by uuid NOT NULL,operation_id uuid NOT NULL,edition text NOT NULL CHECK(edition IN ('java','bedrock')),
 requested_name varchar(32) NOT NULL CHECK(length(trim(requested_name))>0),
 state text NOT NULL DEFAULT 'pending' CHECK(state='pending'),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours'),
 UNIQUE(organization_id,id),UNIQUE(organization_id,operation_id),
 FOREIGN KEY(organization_id,project_id,environment_id,server_id) REFERENCES minecraft_servers(organization_id,project_id,environment_id,id),
 FOREIGN KEY(organization_id,server_id,operation_id) REFERENCES management_operations(organization_id,server_id,id),
 FOREIGN KEY(organization_id,requested_by) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX minecraft_identity_enrollments_scope ON minecraft_identity_enrollments(organization_id,server_id,id);
CREATE INDEX minecraft_identity_enrollments_requester ON minecraft_identity_enrollments(organization_id,requested_by);
CREATE TRIGGER minecraft_identity_enrollments_immutable BEFORE UPDATE OR DELETE ON minecraft_identity_enrollments FOR EACH ROW EXECUTE FUNCTION management_immutable();
ALTER TABLE minecraft_identity_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE minecraft_identity_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON minecraft_identity_enrollments USING(organization_id=(SELECT nullif(current_setting('app.organization_id',true),'')::uuid)) WITH CHECK(organization_id=(SELECT nullif(current_setting('app.organization_id',true),'')::uuid));
GRANT SELECT,INSERT ON minecraft_identity_enrollments TO craftlayer_runtime;
