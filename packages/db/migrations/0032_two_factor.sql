-- Master plan A1: two-factor sign-in for adults. A session created by password alone
-- may be "pending" until a one-time code (or recovery code) is verified; pending
-- sessions can only finish signing in. Secrets are stored encrypted by the identity
-- service, never in plain text, and recovery codes only as hashes.
ALTER TABLE sessions ADD COLUMN mfa_pending boolean NOT NULL DEFAULT false;
CREATE TABLE user_totp(
 user_id uuid PRIMARY KEY REFERENCES users(id),
 secret_ciphertext text NOT NULL CHECK(length(secret_ciphertext) BETWEEN 40 AND 512),
 created_at timestamptz NOT NULL,
 confirmed_at timestamptz,
 last_step bigint NOT NULL DEFAULT 0 CHECK(last_step>=0),
 CHECK(confirmed_at IS NULL OR confirmed_at>=created_at)
);
CREATE TABLE user_totp_recovery(
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 code_hash char(64) NOT NULL CHECK(code_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL,
 used_at timestamptz,
 UNIQUE(user_id,code_hash)
);
CREATE INDEX user_totp_recovery_user ON user_totp_recovery(user_id) WHERE used_at IS NULL;
-- last_step only advances; a confirmed enrolment keeps its secret until it is removed.
CREATE FUNCTION user_totp_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.user_id<>OLD.user_id OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Two-factor enrolment identity is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.confirmed_at IS NOT NULL AND (NEW.secret_ciphertext<>OLD.secret_ciphertext OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) THEN RAISE EXCEPTION 'A confirmed two-factor secret cannot be changed; remove it first' USING ERRCODE='23514'; END IF;
 IF NEW.last_step<OLD.last_step THEN RAISE EXCEPTION 'Two-factor step cannot move backwards' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION user_totp_guard() FROM PUBLIC;
CREATE TRIGGER user_totp_guard BEFORE UPDATE ON user_totp FOR EACH ROW EXECUTE FUNCTION user_totp_guard();
CREATE FUNCTION user_totp_recovery_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.code_hash<>OLD.code_hash OR NEW.created_at<>OLD.created_at OR (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at) THEN RAISE EXCEPTION 'Recovery codes are single use' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION user_totp_recovery_guard() FROM PUBLIC;
CREATE TRIGGER user_totp_recovery_guard BEFORE UPDATE ON user_totp_recovery FOR EACH ROW EXECUTE FUNCTION user_totp_recovery_guard();
GRANT SELECT,INSERT,UPDATE,DELETE ON user_totp,user_totp_recovery TO craftlayer_identity;
