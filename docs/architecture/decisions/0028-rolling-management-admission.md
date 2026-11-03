# ADR 0028 — Reclaimable management-operation admission

Status: adopted for local REV-03 checkpoint A, 2026-11-03. Applies only to metadata/read-only management operations; production/family release gates remain.

## Decision

Replace the environment's lifetime 10,000-operation counter with 10,000 operations per rolling 24 hours. Retain the existing 12-per-actor/environment rolling minute limit. Count all operation states within the window; future timestamps conservatively remain counted. Check within the existing scoped management transaction/advisory barrier before a source read or metadata mutation. Idempotent replay remains a current-authority read of the prior operation, consumes no additional capacity and cannot repeat the source query. Authentication, tenant/child scope, fences, versions and explicit read-only source restrictions are unchanged.

Retain error code `MANAGEMENT_LIMIT`/HTTP 429 for compatibility, with messages identifying account/world minute versus world/day budget and retry guidance. No global counts or another tenant's traffic are exposed. A deadline-expired running record remains visible as recovery-required; aging out of an admission budget does not settle it or grant effects.

Do not delete, mutate timestamps, purge audit/outbox or free physical allocations to reclaim this metadata budget. Historical operation IDs and audit records remain readable under current authority. This removes permanent ordinary-use lockout while retaining bounded short-term admission. It is not storage retention: history can grow, so audited retention/archival and storage monitoring remain release work. The separate 200-enrollment lifetime cap/deduplication remains open for REV-03's next checkpoint; do not claim the whole finding closed.

## Evidence and rollback

Real disposable PostgreSQL tests seed 10,000 old terminal operations and prove admission, preserved minute refusal, idempotent replay and minute-window expiry with every historical row retained. Another fills the rolling daily budget and proves refusal, later admission and intact history after the cutoff. Seed rows are explicit synthetic metadata, never existing user/production records.

No schema or historical migration is changed. Reverting code reinstates the lifetime lockout while preserving all history, but does not undo existing requests or authorize deletion. No game/world/Contabo or paid inference action.

## Checkpoint B — expired enrollment capacity

Count only unexpired pending requests against the 200/server budget; retain immutable expired requests, original operations/audit/outbox and the 24-hour request expiry. Existing current-authority idempotent replay precedes quota checks and cannot grant another identity/access or consume a slot. Active-budget refusal preserves ENROLLMENT_LIMIT/429 with expiry guidance. A later new request after expiry is a new unverified pending name request, never renewal of verified ownership or access.

Add SQL 0024 scoped indexes: operation `(organization_id,environment_id,created_at,actor_id)` supports the rolling-day range with account filtering; enrollment `(organization_id,server_id,expires_at)` supports active expiry counts as old history grows. Equality scopes precede time ranges; full index/history remains, with no volatile `now()` partial-index predicate, new privileges or pruning. Drizzle metadata matches. Migration fixtures remove this index migration from pre-management upgrade inputs, then apply it in ordinary fresh/repeat/upgrade runs. Revert application code while retaining additive indexes/history; production migration still needs separate approval. Semantic deduplication, audited retention/archival and real identity/recovery qualification remain open.

## Checkpoint C — deduplicate active pending-name metadata

After current authority and exact UUID replay validation, reject a new key with `ENROLLMENT_PENDING`/409 when the same organization/server, edition and schema-parsed requested name already has an unexpired pending row. Use the existing scoped advisory/server transaction locks to serialize concurrent keys; check before quota admission and do not create an operation, audit/outbox event or enrollment for a refused duplicate. Successful original-key replay still returns the original receipt, including after expiry, without extending its lifetime. A fresh key at/after expiry can create a new immutable request; retained history is unchanged.

Comparison is exact after existing schema parsing (including Bedrock surrounding-whitespace trimming). Do not case-fold, perform Unicode account normalization, merge editions or infer UUID/XUID/account equivalence from unverified names. Different name spellings may remain separate until authenticated identity resolution exists. Another authorized adult cannot duplicate the active metadata; the conflict exposes no original actor, session, operation or enrollment ID. Different servers/editions remain independent. Existing SQL 0024 scoped expiry index bounds the active-row lookup; no schema/grant/index change is needed for this at-most-200 active-row scan.

This changes repeated new-key submissions from another accepted metadata operation to an explicit conflict. Clients can keep the original receipt/replay key or refresh their authorized list. No state is withdrawn, verified or granted access. Audited retention/archival, chronological history pagination and real identity/recovery remain separate. Reverting this application check allows duplicate metadata again but does not remove or renew existing requests.
