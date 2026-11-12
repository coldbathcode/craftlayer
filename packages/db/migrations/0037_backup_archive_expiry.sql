-- Master plan D1: old archives are deleted by the bound node under the retention rules
-- (ADR 0049). The record stays; this marks, once, that its archive is gone. A backup
-- under legal hold can never be marked, and a marked backup can never be held.
ALTER TABLE minecraft_backups ADD COLUMN archive_removed_at timestamptz;
ALTER TABLE minecraft_backups ADD CONSTRAINT minecraft_backups_removed CHECK(archive_removed_at IS NULL OR (state='complete' AND legal_hold=false AND archive_removed_at>=completed_at));
CREATE FUNCTION backup_archive_removed_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF OLD.archive_removed_at IS NOT NULL AND NEW.archive_removed_at IS DISTINCT FROM OLD.archive_removed_at
 THEN RAISE EXCEPTION 'Archive removal is recorded once' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION backup_archive_removed_guard() FROM PUBLIC;
CREATE TRIGGER minecraft_backups_archive_removed BEFORE UPDATE ON minecraft_backups FOR EACH ROW EXECUTE FUNCTION backup_archive_removed_guard();
