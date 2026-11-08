# Backup records (policy, schedule, evidence)

Status: master plan [D1](../plan/D-backups.md) record layer built and verified in the disposable database suite on 2026-11-08. **No backup is taken yet.** The rules are [ADR 0033](../architecture/decisions/0033-backup-schedule-semantics.md); the records are [ADR 0038](../architecture/decisions/0038-backup-records.md).

## What exists

- A per-server **backup policy** (time zone, local time, retention days, off-site weekday, enabled) stored as append-only revisions.
- **Occurrences**: one per logical backup, scheduled (one per local date) or manual ("Back up now"), with forward-only state.
- **Backup records**: one per occurrence, complete only with archive hash, size and manifest hash; verification evidence set once; legal hold with author.
- Computed **schedule status** (`current`, `due`, `overdue`, `clock_anomaly`, `disabled`), **health** (local, off-site, restore; `none` until proven) and a **retention plan** (what to keep and why; nothing is deleted).

## API (adult session or agent bearer)

| Call | Permission | Effect |
| --- | --- | --- |
| `GET /api/v1/servers/{id}/backup-status` | `backup:read` | Policy, schedule, health, open occurrence, `can_manage` |
| `PUT /api/v1/servers/{id}/backup-policy` + `Idempotency-Key` | `backup:manage` (adult) | New policy revision |
| `POST /api/v1/servers/{id}/backups` + `Idempotency-Key` | `backup:manage` (adult) | Records a manual request; 409 `BACKUP_POLICY_REQUIRED` without a policy, 409 `BACKUP_IN_PROGRESS` while one is open |
| `GET /api/v1/servers/{id}/backups` | `backup:read` | Records with occurrence detail and the retention plan |
| `PUT /api/v1/servers/{id}/backups/{backup}/legal-hold` | `backup:manage` (adult) | Sets or clears a legal hold |

Agents (MCP `list_backups`) can read; they cannot request, hold, restore or delete.

## Checks

```bash
pnpm test:db   # includes tests/integration/backup-records.integration.test.ts
```

The suite proves: revisions stay sequential with one `policy_id`; replayed keys return the same result and changed bodies conflict; children, viewers and agents are refused writes; other environments are refused reads; a manual request opens exactly one occurrence and blocks a second; the scheduler creates exactly one occurrence after a two-day gap and nothing while one is open; completion needs evidence and closes the request operation; health stays `none` until verified and recovery-point age counts from creation; retention keeps an unverified-only archive and a held one; direct SQL cannot delete records, clear evidence, move state backwards, rewrite archive hashes or set a legal hold without an author; the outbox carries one event per transition.

## Archive library (node agent)

`apps/minecraft-node/src/game-control/backup.ts` makes the archive that fills these records ([ADR 0039](../architecture/decisions/0039-backup-archive-consistency.md)): `createBackupArchive` pauses saving, flushes, hashes every included file, writes `<occurrence>.tar.gz` with the system `tar` from an explicit file list, hashes again to prove nothing changed, writes a manifest and always resumes saving. `verifyBackupArchive` checks archive hash, size and exact member list against the manifest; `restoreBackupArchive` verifies, extracts into an empty directory and re-hashes every file. Logs, caches, libraries, versions, crash reports and the EULA marker are excluded and listed; symlinks are skipped and listed. The opt-in `pnpm test:game-control` run takes a live backup of the disposable Paper server, verifies it, restores it into a fresh directory, boots a server from the restored files and confirms the allowlist came back.

## Not yet

The nightly scheduler loop that calls `scheduleDue` and runs the archive on the node under its occurrence, the off-site copy, periodic restore tests against stored archives, and expiry. Archives contain plugin secrets (for example Floodgate's `key.pem`) and must stay on protected storage until the encryption step. Until the loop exists, every server shows `local: none` and the family world has no backup.
