ALTER TABLE audit_events ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE instance_audit_events ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE invitations ADD COLUMN revoked_at timestamptz;
