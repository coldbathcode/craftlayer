CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  name varchar(120) NOT NULL CONSTRAINT organizations_name_nonempty CHECK (length(trim(name)) > 0),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE projects (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name varchar(120) NOT NULL CONSTRAINT projects_name_nonempty CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_org_id_unique UNIQUE (organization_id,id)
);
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_scope ON organizations
  USING (id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.organization_id', true), '')::uuid);
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope ON projects
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, projects TO craftlayer_runtime;
