# ADR 0049 — Old backup archives are deleted by the bound node, only as the retention rules allow

Status: adopted for master plan step D1 (expiry) on 2026-11-12. Built and verified locally over a real mTLS transport with real archives on disk. Not yet on the family VPS; that state is on the [status board](../../plan/STATUS.md).

## Context

The bound node writes one archive a night ([ADR 0045](0045-node-backups.md)) and nothing ever removed one, so the backup folder would grow until the disk filled. The retention rules already say what may go ([ADR 0033](0033-backup-schedule-semantics.md)), but only as a proposal shown in the list.

## Decision

1. **The controller decides, the node deletes.** Once an hour, and never while it is writing a backup, the node asks on the existing mTLS link (`node.backups.prune.poll.v1`). The gateway answers with at most twenty backups for servers bound to that node, named by backup and occurrence id. No path travels either way.
2. **Exactly the retention plan, nothing more.** Offered are complete backups the ADR 0033 plan marks expirable: older than the policy's retention (never under 14 days), not under legal hold, and not the newest verified, off-server-verified or restore-tested backup. While no backup is verified, nothing is offered. A server without a policy, and any server under an emergency stop, is skipped.
3. **Fixed names inside the server's own folder.** The node deletes `<archive folder>/<server id>/<occurrence id>.tar.gz` and its manifest. Both ids must be plain UUIDs, so no other file can be named. A file already gone counts as removed.
4. **The record stays and says so.** The node reports each deletion (`node.backups.prune.result.v1`); the gateway sets `archive_removed_at` once (migration 0037) and writes `server.backup_archive_expired` to the audit log. The database refuses to clear the mark, and refuses it on a backup under legal hold.
5. **A removed backup is history, not a recovery point.** It no longer counts towards backup health or protects other backups in the plan, and the family screen shows it as "no longer kept".

## Consequences

- If the report is lost after the file is deleted, the backup is offered again next hour and the node reports it removed; nothing is deleted twice.
- A legal hold placed in the seconds between the offer and the deletion does not save that archive; the hold is checked when the offer is made.
- Failed backups have no archive and are never offered; any partial files they left are not cleaned up by this step.
- Off-server copies (D2) will need their own expiry.
