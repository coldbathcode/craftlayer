# ADR 0028 — Reclaimable management-operation admission

Status: adopted for local REV-03 checkpoint A, 2026-11-03. Applies only to metadata/read-only management operations; production/family release gates remain.

## Decision

Replace the environment's lifetime 10,000-operation counter with 10,000 operations per rolling 24 hours. Retain the existing 12-per-actor/environment rolling minute limit. Count all operation states within the window; future timestamps conservatively remain counted. Check within the existing scoped management transaction/advisory barrier before a source read or metadata mutation. Idempotent replay remains a current-authority read of the prior operation, consumes no additional capacity and cannot repeat the source query. Authentication, tenant/child scope, fences, versions and explicit read-only source restrictions are unchanged.

Retain error code `MANAGEMENT_LIMIT`/HTTP 429 for compatibility, with messages identifying account/world minute versus world/day budget and retry guidance. No global counts or another tenant's traffic are exposed. A deadline-expired running record remains visible as recovery-required; aging out of an admission budget does not settle it or grant effects.

Do not delete, mutate timestamps, purge audit/outbox or free physical allocations to reclaim this metadata budget. Historical operation IDs and audit records remain readable under current authority. This removes permanent ordinary-use lockout while retaining bounded short-term admission. It is not storage retention: history can grow, so audited retention/archival and storage monitoring remain release work. The separate 200-enrollment lifetime cap/deduplication remains open for REV-03's next checkpoint; do not claim the whole finding closed.

## Evidence and rollback

Real disposable PostgreSQL tests seed 10,000 old terminal operations and prove admission, preserved minute refusal, idempotent replay and minute-window expiry with every historical row retained. Another fills the rolling daily budget and proves refusal, later admission and intact history after the cutoff. Seed rows are explicit synthetic metadata, never existing user/production records.

No schema or historical migration is changed. Reverting code reinstates the lifetime lockout while preserving all history, but does not undo existing requests or authorize deletion. No game/world/Contabo or paid inference action.
