# ADR 0033 — Backup schedule and retention semantics

Status: adopted for authorized local CL-F2-03 checkpoint A, 2026-11-07. Pure decision logic only; no save, archive, restore, transfer or deletion capability.

## Dependency refinement

CL-F2-03 is listed after CL-F2-02 as a conservative chain. CL-F2-01 and CL-F2-02 need real Bedrock clients and owner-supplied accounts, which are pending. Backup schedule and retention logic has no dependency on allowlist operations and reduces rather than bypasses risk, so this checkpoint starts early with this justification. It is not a reorder around a safety gate: family-ready still requires every F2 task and gate, and no backup effect exists yet.

## Decision

Add strict `backupPolicy`/`backupRecord` contracts and pure functions in `packages/minecraft-control`.

**One logical backup per policy and local date.** The occurrence ID hashes policy ID and local date only. Revision and time are excluded, so editing a policy cannot create a second logical backup for a date already taken.

**DST.** A repeated wall time runs once, at its first instant. A skipped wall time runs just after the gap, using the offset in force before it, so no daily run is lost. Zone rules come from the runtime's `Intl` data, so behaviour follows the deployed ICU version.

**Bounded catch-up.** Reconciliation returns at most one due occurrence, however long the outage, with the true missed count. A long outage reports `overdue`; it never creates a burst of runs against a live world. An occurrence more than one hour late is also `overdue`.

**Clock anomaly.** A recorded date later than the latest possible occurrence returns `clock_anomaly` and nothing due. It stops rather than guesses.

**Retention fails closed.** Planning only proposes; deletion stays a separate audited effect. It always keeps legal holds, in-progress work, the retention window and the newest backup with each of verified, off-host verified and restore-tested evidence. Failed records never count as evidence. If no verified backup exists, every complete backup is kept, because an unproven archive may be the only copy of a family world. Retention is at least 14 days.

**Separate health.** Local, off-host and restore evidence stay independent, and absent evidence reports `none`, never healthy. Recovery-point age runs from backup creation, not from a later verification. A one-day off-host grace (eight days) avoids alarming on a slightly late weekly copy. Restore reports only whether a test exists: no staleness threshold is defined yet, so none is invented here.

## Limits

No SQL, API, UI, worker, lease, save coordination, archive, encryption or off-host transfer exists. Nothing here proves any backup works; MC-08 restore, corruption, key, disk and extraction gates remain open. The existing VPS worlds have no scheduled backup.

Next: durable policy, occurrence and backup records with scoped adult permissions, then archive and manifest verification using the F0 preservation code.

## Evidence and rollback

Unit tests cover the rules above, including a two-year sweep across five zones. Exact results are in the build log. The change is additive and has no persisted state, so rollback is removing the module.
