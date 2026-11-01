ALTER TABLE runtime_attempts ADD COLUMN worker_stopped_at timestamptz;
CREATE TABLE runtime_reconciliations(
 organization_id uuid NOT NULL,attempt_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),evidence_hash char(64) NOT NULL CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),reason varchar(240) NOT NULL,created_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,attempt_id),FOREIGN KEY(organization_id,attempt_id) REFERENCES runtime_attempts(organization_id,id)
);
ALTER TABLE runtime_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_reconciliations FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_reconciliations_scope ON runtime_reconciliations USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON runtime_reconciliations TO craftlayer_runtime;
