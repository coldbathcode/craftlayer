CREATE TABLE provider_connections (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 kind text NOT NULL CHECK(kind IN ('ollama','openrouter')), endpoint_id varchar(40) NOT NULL,
 label varchar(80) NOT NULL CHECK(length(trim(label))>0), enabled boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), credential_version integer NOT NULL DEFAULT 0,
 key_id varchar(40), credential_payload bytea, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), CHECK((credential_payload IS NULL AND key_id IS NULL AND credential_version=0) OR (credential_payload IS NOT NULL AND key_id IS NOT NULL AND credential_version>0))
);
CREATE INDEX provider_connections_org ON provider_connections(organization_id,created_at,id);
CREATE TABLE model_snapshots (
 organization_id uuid NOT NULL, connection_id uuid NOT NULL, connection_version integer NOT NULL,
 model_id varchar(180) NOT NULL, descriptor jsonb NOT NULL CHECK(pg_column_size(descriptor)<=32768),
 fetched_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,connection_id,model_id),
 FOREIGN KEY(organization_id,connection_id) REFERENCES provider_connections(organization_id,id)
);
CREATE INDEX model_snapshots_expiry ON model_snapshots(organization_id,expires_at);
ALTER TABLE provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON provider_connections USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE model_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON model_snapshots USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON provider_connections,model_snapshots TO craftlayer_runtime;
GRANT INSERT ON audit_events TO craftlayer_runtime;
GRANT USAGE ON SEQUENCE audit_events_id_seq TO craftlayer_runtime;
