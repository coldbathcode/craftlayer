# ADR 0038 — Durable backup records: policy revisions, occurrences and evidence

Status: adopted for master plan step D1 / CL-F2-03 checkpoint B, 2026-11-08. Records and decisions only; no save, archive, copy, restore or deletion exists yet.

## Context

[ADR 0033](0033-backup-schedule-semantics.md) fixed the pure rules: one logical backup per policy and local date, bounded catch-up, retention that fails closed, separate health signals. Those rules need durable state and adult-scoped permissions so the dashboard can show backup health, a manager can press **Back up now**, and the node agent has a place to write proof once it performs backups.

## Decision

1. **Permissions.** `backup:read` (viewers, operators, administrators, and agent tokens) and `backup:manage` (administrators; adults only, never agents). Every method re-checks the permission in the server's environment after locating the server with an organization read.
2. **Policies are append-only revisions.** Each edit inserts a new row; a trigger enforces sequential revisions and a constant `policy_id`, so editing a policy can never create a second logical backup for a date already taken. Disabling is a revision with `enabled=false`.
3. **Occurrences are the idempotency unit.** A scheduled occurrence's key is the ADR 0033 occurrence hash; a manual one's key is a hash of its request operation. `UNIQUE(organization, server, key)` makes the scheduler and retries idempotent, and at most one occurrence per server may be open (`pending` or `running`). State only moves forward (`pending → running → complete|failed`, or `pending → failed`); identity is immutable; rows are never deleted.
4. **One backup record per occurrence, evidence set once.** A record becomes `complete` only with archive hash, size and manifest hash. `verified_at`, `offhost_verified_at` and `restore_tested_at` are set once and never cleared or moved. Legal hold may change, but only with the changing adult and time recorded. Records are never deleted by the runtime role; expiry will be a separate audited effect.
5. **"Back up now" records a request, not a result.** It creates a `backup_request` operation that stays `running` with a one-hour deadline and a pending manual occurrence; the operation view reports `recovery_required` once the deadline passes without a result, so a stalled request is visible rather than silently "done".
6. **Effect-side writes have no HTTP surface.** `scheduleDue`, `recordStarted`, `recordComplete`, `recordFailed` and `recordEvidence` are composition-trusted methods for the scheduler and the node receipt path. Nothing a browser or agent can call marks a backup complete or verified.
7. **Health and retention are computed, not stored.** Views apply the ADR 0033 functions to the current records at read time, so no cached "healthy" can go stale, and `family_ready` is a literal `false` until a restore has been proven on that server.

## Consequences

- The nightly scheduler loop and the node-side backup effect (save-off, flush, archive, hash, save-on) are the next D1 work; they write through the `record*` methods.
- Off-site copy (D2) and automatic restore tests (D3) add evidence through `recordEvidence`; they never widen what a read can claim.
- Agents may list backup state read-only; the SQL allowlist on agent tokens was widened by exactly `backup:read`.
