-- Templates are scoped to the same canonical environment as their mission.
-- No public runtime writer existed before this migration.
ALTER TABLE runtime_templates ADD COLUMN project_id uuid NOT NULL;
ALTER TABLE runtime_templates ADD COLUMN environment_id uuid NOT NULL;
ALTER TABLE runtime_templates ADD FOREIGN KEY(organization_id,project_id,environment_id) REFERENCES environments(organization_id,project_id,id);
ALTER TABLE runtime_templates ADD UNIQUE(organization_id,project_id,environment_id,id,hash);
ALTER TABLE runtime_missions ADD FOREIGN KEY(organization_id,project_id,environment_id,template_id,template_hash) REFERENCES runtime_templates(organization_id,project_id,environment_id,id,hash);
CREATE TABLE runtime_idempotency(
 organization_id uuid NOT NULL,actor_id uuid NOT NULL,route varchar(120) NOT NULL,key uuid NOT NULL,request_hash char(64) NOT NULL,response jsonb NOT NULL CHECK(octet_length(response::text)<=1048576),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,actor_id,route,key),FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
ALTER TABLE runtime_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_idempotency_scope ON runtime_idempotency USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON runtime_idempotency TO craftlayer_runtime;
REVOKE UPDATE ON runtime_group_agents FROM craftlayer_runtime;
