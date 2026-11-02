-- Separate adult placement/provision permissions. Preview grants no effect authority.
INSERT INTO permissions(id) VALUES ('node:deploy'),('server:provision');
INSERT INTO built_in_role_permissions(role_name,permission) SELECT 'org_admin',p FROM unnest(ARRAY['node:deploy','server:provision']) p;
CREATE POLICY provision_plan_migration_discovery ON organizations FOR SELECT TO craftlayer_migrator USING(true);
DO $$ DECLARE org uuid; BEGIN
 FOR org IN SELECT id FROM organizations LOOP
  PERFORM set_config('app.organization_id',org::text,true);
  INSERT INTO role_permissions(organization_id,role_id,permission) SELECT org,r.id,p FROM roles r CROSS JOIN unnest(ARRAY['node:deploy','server:provision']) p WHERE r.organization_id=org AND r.built_in AND r.name='org_admin' ON CONFLICT DO NOTHING;
 END LOOP; PERFORM set_config('app.organization_id','',true);
END $$;
DROP POLICY provision_plan_migration_discovery ON organizations;
