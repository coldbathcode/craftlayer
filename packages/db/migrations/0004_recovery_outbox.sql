CREATE TABLE identity_mail_outbox (
 token_id uuid PRIMARY KEY REFERENCES password_reset_tokens(id),
 payload bytea NOT NULL,
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_id uuid, lease_expires_at timestamptz, delivered_at timestamptz
);
CREATE INDEX recovery_outbox_pending ON identity_mail_outbox(next_attempt_at) WHERE delivered_at IS NULL;
GRANT SELECT,INSERT,UPDATE,DELETE ON identity_mail_outbox TO craftlayer_identity;
