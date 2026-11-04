# CraftLayer session handoff — CL-F25-03/J

**Date:** 2026-11-04 UTC. **Agent/session:** Codex. **Branch/base/head:** main, base `d108347`, head is this checkpoint's commit. **Authorized scope:** local F2/F25/F3 and task commits/pushes; no Chapter 04, production or live world action.

## Current state

Private durable deployment review requests bind exact canonical reservation/intent/resource/plan/node/credential/original session and stop state. SQL 0026 retains sealed original grants privately and persists immutable awaiting-review metadata, atomic audit and reference-only outbox; there is no decision or execution authority. Requests last at most five minutes, replay without renewal and reject stale scope/stop/credential or already-issued command state. Read projections remain explicitly unverified and execution-disabled. See [ADR 0030](../../architecture/decisions/0030-durable-deployment-review-requests.md).

## Working tree

Task-owned contracts, metadata service, SQL/Drizzle, migration fixtures, tests and linked documentation are committed together. The pre-existing full-project review document and unrelated backlog/status review hunks remain preserved and excluded. Inspect status before editing; do not claim whole-tree cleanliness or discard another session's review.

## Checks and evidence

Exact commands/counts/failures are in the [build log](../build-log.md) and F25 progress review. Tests use disposable PostgreSQL and explicit fake reservation admission only. They prove metadata and denial behavior, not a real independent approval or qualified game deployment. Previous `d108347` hosted CI completed successfully in both foundation and management-browser jobs, run 41639216188.

## Decisions and blockers

Original actor/session must create the request; a different current adult with both placement/provision scopes may inspect the redacted snapshot. A hash identifies review content and cannot authorize effects. Request expiry has no renewal path yet. Existing initial reservation qualification/approval remains a separate unavailable production adapter. No routes or installed runner are enabled.

## Next action

Implement independent approval decisions against the exact stored request and review hash, with current `approval:decide` plus canonical placement/provision authority, self-approval denial, rejection/revocation, original/reviewer authority revalidation and no job/lease renewal. Keep actual storage/game/identity/recovery qualification separate and deny absent adapters. Test and publish that coherent checkpoint before wiring execution.
