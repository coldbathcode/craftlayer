CREATE TABLE runtime_workers(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,environment_id uuid NOT NULL,name varchar(120) NOT NULL,
 protocol integer NOT NULL CHECK(protocol=1),token_hash char(64) NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 expires_at timestamptz NOT NULL,revoked_at timestamptz,last_seen_at timestamptz,
 UNIQUE(organization_id,id),UNIQUE(organization_id,project_id,environment_id,id),
 FOREIGN KEY(organization_id,project_id,environment_id) REFERENCES environments(organization_id,project_id,id)
);
ALTER TABLE runtime_attempts ADD COLUMN deadline_at timestamptz NOT NULL;
ALTER TABLE runtime_attempts ADD FOREIGN KEY(organization_id,project_id,environment_id,worker_id) REFERENCES runtime_workers(organization_id,project_id,environment_id,id);
ALTER TABLE runtime_approvals ADD COLUMN approver_grant jsonb;
CREATE TABLE runtime_model_calls(
 organization_id uuid NOT NULL,mission_id uuid NOT NULL,task_id uuid NOT NULL,attempt_id uuid NOT NULL,step integer NOT NULL CHECK(step BETWEEN 0 AND 2),
 request_id uuid NOT NULL UNIQUE,state text NOT NULL CHECK(state IN ('prepared','dispatched','completed','invalid','uncertain')),proposal jsonb CHECK(proposal IS NULL OR octet_length(proposal::text)<=4096),
 PRIMARY KEY(organization_id,attempt_id,step),FOREIGN KEY(organization_id,mission_id,task_id,attempt_id) REFERENCES runtime_attempts(organization_id,mission_id,task_id,id)
);
ALTER TABLE runtime_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_workers FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_workers_scope ON runtime_workers USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON runtime_workers TO craftlayer_runtime;
ALTER TABLE runtime_model_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_model_calls FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_model_calls_scope ON runtime_model_calls USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON runtime_model_calls TO craftlayer_runtime;
