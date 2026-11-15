-- Master plan G (ADR 0052): adults who may create, run and stop AI players. Standing
-- authority for a running AI player re-checks this permission on every model call.
INSERT INTO permissions(id) VALUES ('ai_player:manage') ON CONFLICT DO NOTHING;
INSERT INTO built_in_role_permissions(role_name,permission) VALUES ('org_admin','ai_player:manage') ON CONFLICT DO NOTHING;
CREATE POLICY g_migration_discovery ON organizations FOR SELECT TO craftlayer_migrator USING(true);
DO $$ DECLARE org uuid; BEGIN
 FOR org IN SELECT id FROM organizations LOOP
  PERFORM set_config('app.organization_id',org::text,true);
  INSERT INTO role_permissions(organization_id,role_id,permission)
   SELECT org,r.id,p.permission FROM roles r JOIN built_in_role_permissions p ON p.role_name=r.name
   WHERE r.organization_id=org AND r.built_in AND p.permission='ai_player:manage' ON CONFLICT DO NOTHING;
 END LOOP;
 PERFORM set_config('app.organization_id','',true);
END $$;
DROP POLICY g_migration_discovery ON organizations;
