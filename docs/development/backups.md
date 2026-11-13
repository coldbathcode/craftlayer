# Backup records (policy, schedule, evidence)

Status: master plan [D1](../plan/D-backups.md) record layer built on 2026-11-08; the nightly loop on the node built and verified locally on 2026-11-12 ([ADR 0045](../architecture/decisions/0045-node-backups.md)). **The family world still has no backup** until the loop is switched on for the VPS (see below). The rules are [ADR 0033](../architecture/decisions/0033-backup-schedule-semantics.md); the records are [ADR 0038](../architecture/decisions/0038-backup-records.md).

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

## Nightly loop on the node

The agent asks the gateway every 15 seconds whether a backup is due for the servers it can back up. The gateway creates tonight's occurrence when the policy says so, or hands over a waiting "Back up now", marks it running on that node and offers it. The agent journals it, pauses saving, archives, resumes saving, re-reads the archive against its manifest and reports the hashes; the gateway records the backup as complete and verified. Details and limits are in [ADR 0045](../architecture/decisions/0045-node-backups.md).

To switch it on for a server that already has a bound host ([server actions](server-actions.md#dispatch-to-a-host)):

1. Create an archive directory **outside** the game data directory, owned by the agent's user, mode `0700`.
2. Add `infra/compose/game-backups.yml` to the stack with `CRAFTLAYER_GAME_BACKUP_DIR` set to that directory. It also sets `CRAFTLAYER_NODE_BACKUPS=enabled` on the gateway.
3. Add both paths, as the agent sees them, to the server's entry in the agent's private configuration, then restart the agent:

```json
"data_directory": "/srv/game/data",
"backup_directory": "/srv/game/backups"
```

4. Set a policy (`PUT /api/v1/servers/{id}/backup-policy`). The first backup is taken at the next scheduled time, or at once with `POST /api/v1/servers/{id}/backups`.

Archives land in `<backup_directory>/<server id>/<occurrence id>.tar.gz` with a `.manifest.json` beside each.

What a failed backup means:

| `failure_code` | Meaning |
| --- | --- |
| `save_failed` | The console did not answer or the flush was not confirmed; nothing was archived. Includes a server that is switched off |
| `archive_failed` | Not enough free space, `tar` failed, or the world changed twice while being read |
| `verification_failed` | The archive did not match its manifest when read back; it is not recorded as a backup |
| `interrupted` | The agent restarted mid-backup or did not answer within two hours. It turns saving back on when it returns |
| `node_unavailable` | "Back up now" was not picked up by a host within an hour |
| `cancelled` | The adult who asked is no longer a member |

Agent log codes worth acting on: `NODE_BACKUP_OPERATOR_CHECK_SAVING` and `NODE_BACKUP_INTERRUPTED_SAVING_UNCONFIRMED` mean the agent could not confirm the world is saving again; run `save-on` or check the server.

Checks: `pnpm test` covers the worker, journal and runner (`apps/minecraft-node/src/backup-worker.test.ts`); `pnpm test:db` runs three cases in `tests/integration/server-actions.integration.test.ts` over real mTLS with real archives: a due nightly backup recorded verified and never repeated, "Back up now" with a lost offer and answers refused from any other node, and nothing scheduled under an emergency stop with stuck, orphaned and unclaimed work closed honestly.

## Expiry of old archives

Built 2026-11-12 ([ADR 0049](../architecture/decisions/0049-backup-archive-expiry.md)). Once an hour the helper asks which archives it may delete and removes exactly those: complete backups older than the policy's retention that are not under legal hold and are not the newest verified, off-server-verified or restore-tested backup. While no backup is verified, nothing is deleted. The record stays, with `archive_removed_at` set, and the list and health ignore it as a recovery point.

## Off-server copy

Built 2026-11-13 ([ADR 0050](../architecture/decisions/0050-offsite-backup-copy.md)). With `"offsite_recipient": "age1…"` in a server's entry of the helper's private configuration (beside `data_directory` and `backup_directory`), every verified backup is also written as `<occurrence>.tar.gz.age`, readable only with the matching private key.

On the owner's machine (needs `age`, `ssh` access to the host and Node):

```bash
age-keygen -o <private-folder>/identity.txt        # the public key goes into the helper's configuration
node scripts/offsite/pull-backups.mjs <config.json>
# config.json: { "ssh_host": "<ssh alias>", "remote_directory": "<archive folder>/<server id>",
#                "local_directory": "<where copies live>", "identity_file": "<private-folder>/identity.txt", "keep": 30 }
```

Each run prints one line per copy (`offsite_copy_ok` or `offsite_copy_failed`) and writes `status.json` in the local folder. Exit code 1 means at least one copy could not be proven. To read a copy: `age -d -i identity.txt <occurrence>.tar.gz.age > world.tar.gz`.

```bash
pnpm exec vitest run tests/unit/offsite-pull.test.ts   # real age on both sides; skipped where age is not installed
```

## Not yet

A first real backup on the family VPS, the dashboard showing the off-server copy (the proof stays on the owner's machine for now), a warning when pulls stop, and periodic restore tests against stored archives (D3). Archives contain plugin secrets (for example Floodgate's `key.pem`) and must stay on protected storage until the encryption step. A switched-off server is not backed up yet.
