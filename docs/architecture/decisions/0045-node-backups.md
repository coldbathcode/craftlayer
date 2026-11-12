# ADR 0045 — The bound node takes the nightly backup; its question is the schedule's clock

Status: adopted for master plan step D1 on 2026-11-12. Built and verified locally over a real mTLS transport with a scripted game console and real archives on disk. Not yet enabled on the family VPS; that state is on the [status board](../../plan/STATUS.md).

## Context

The backup records ([ADR 0038](0038-backup-records.md)) decided when a backup is due and stored its evidence, and the archive library ([ADR 0039](0039-backup-archive-consistency.md)) could make a consistent, verifiable archive, but only from a test. Nothing joined them, so the family world had no backup. Server actions already travel to a bound node over the private signed link ([ADR 0044](0044-server-action-dispatch.md)); backups need the same link with different rules, because a backup takes minutes rather than a second and reads the whole world.

## Decision

1. **Same link, own purposes, own switch.** `node.backups.poll.v1` and `node.backups.result.v1` ride the existing mTLS listener and are authenticated exactly like a heartbeat (certificate, credential, signature, 30-second window, strictly increasing sequence). Replies are signed by the control key and bound to the request. The routes exist only when the operator sets `CRAFTLAYER_NODE_BACKUPS=enabled` on the gateway, separately from server actions.
2. **The node's question is the clock.** There is no separate scheduler process. When a node asks, the gateway looks only at servers bound to that active node, creates the scheduled occurrence if the policy says one is due (the ADR 0033 rules, unchanged) and hands it over in the same transaction. A server with no connected host is therefore never marked as backing up; its status simply becomes overdue. Time is always the gateway's.
3. **One backup at a time, handed to one node.** The occurrence records the node it went to, set once when it starts (migration 0034). Only that node may answer, and only for the same server. A backup already running on the asking node is offered again, so a lost reply delays a backup and never repeats it.
4. **Emergency stop outranks the schedule.** Under a latched stop nothing is scheduled and nothing is handed out. A manual request whose author is no longer a member is recorded as cancelled instead of run.
5. **Success means read back.** The node pauses saving, flushes, archives, proves the world did not change, resumes saving, then re-reads the archive against its manifest. Only then does it report success, with the archive hash, size and manifest hash, and the gateway records the backup as complete and verified in one step. A world that changed while being read is tried once more; nothing else is retried on the node.
6. **Journal before effect.** The node writes the occurrence to a private journal before it pauses saving and writes the outcome before sending it. A backup found in the journal with no outcome after a restart is never archived again: the node turns saving back on, reports `interrupted`, and logs whether the server confirmed.
7. **Leases instead of retries.** A started backup that is not answered within two hours is recorded as `interrupted`; "Back up now" that no host picks up within an hour is recorded as `node_unavailable`. A later answer cannot rewrite the record and is written to the audit log as `server.backup_late_result`. The next scheduled day or a new request starts a fresh occurrence.
8. **Paths belong to the operator.** The agent's private configuration names each server's data directory and a separate archive directory; the agent refuses to start if one contains the other. No path, command or archive bytes cross the link, and the gateway never sees the archive.
9. **The archive runs beside the loop.** The agent archives in the background while it keeps its heartbeat and action loop going; every exchange with the gateway still happens one at a time. On shutdown it waits for a backup in flight to resume saving and record its outcome.

## Consequences

- The gateway's backup service runs without an identity service, like its action service. People still set the policy and press "Back up now" through the public API with their own permissions.
- A failed night is not retried that night. An adult can press "Back up now"; health turns `overdue` by the ADR 0033 thresholds.
- A backup fails with `save_failed` when the console does not answer, including when the server is switched off. Backing up a stopped server needs the node to know it is stopped, which arrives with container lifecycle (A3).
- An allowlist change during a backup can make the world "change"; the single retry covers the common case.
- Archives are not encrypted and are not deleted yet. They contain plugin secrets, so the archive directory must be private to the agent's user. Encryption arrives with the off-server copy (D2); expiry of old archives is the remaining D1 item and nothing can be due for expiry before the 14-day minimum retention.
- Restore tests (D3) and real restores (D4) will add their own purposes on the same link.
