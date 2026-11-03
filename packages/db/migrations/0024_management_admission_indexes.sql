-- Reclaimable metadata budgets: equality scope precedes the rolling time range.
-- Full immutable history is retained; these indexes grant no additional access.
CREATE INDEX management_operations_window ON management_operations(organization_id,environment_id,created_at,actor_id);
CREATE INDEX minecraft_identity_enrollments_expiry ON minecraft_identity_enrollments(organization_id,server_id,expires_at);
