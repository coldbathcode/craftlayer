-- Stable newest-first history without OFFSET or truncating the cursor timestamp.
-- Retains all enrollment history and existing privileges.
CREATE INDEX minecraft_identity_enrollments_history ON minecraft_identity_enrollments(organization_id,server_id,created_at DESC,id DESC);
