-- Master plan G8: an AI agent (MCP) may list AI players, read their conversation, give
-- them instructions and stop them. It can never start one, change settings or limits.
-- Like every agent permission, the token never exceeds its creating adult.
INSERT INTO permissions(id) VALUES ('ai_player:instruct') ON CONFLICT DO NOTHING;
INSERT INTO built_in_role_permissions(role_name,permission) VALUES ('org_admin','ai_player:instruct') ON CONFLICT DO NOTHING;
CREATE POLICY g8_migration_discovery ON organizations FOR SELECT TO craftlayer_migrator USING(true);
DO $$ DECLARE org uuid; BEGIN
 FOR org IN SELECT id FROM organizations LOOP
  PERFORM set_config('app.organization_id',org::text,true);
  INSERT INTO role_permissions(organization_id,role_id,permission)
   SELECT org,r.id,p.permission FROM roles r JOIN built_in_role_permissions p ON p.role_name=r.name
   WHERE r.organization_id=org AND r.built_in AND p.permission='ai_player:instruct' ON CONFLICT DO NOTHING;
 END LOOP;
 PERFORM set_config('app.organization_id','',true);
END $$;
DROP POLICY g8_migration_discovery ON organizations;
ALTER TABLE agent_tokens DROP CONSTRAINT agent_tokens_permissions_check;
ALTER TABLE agent_tokens ADD CONSTRAINT agent_tokens_permissions_check CHECK(
 cardinality(permissions) BETWEEN 1 AND 16
 AND permissions <@ ARRAY['organization:read','project:read','environment:read','server:read','player:read','operation:read','node:read','event:read','mission:read','agent:read','backup:read','ai_player:instruct']::text[]
);
