# CraftLayer session handoff — REV-03/C

**Date:** 2026-11-03 UTC. **Agent/session:** Codex. **Branch/base/head:** main, base `1dc4668`, head is this checkpoint's commit. **Authorized scope:** local F2 pending metadata and task publication; no live world/VPS/game actions.

## Current state

Concurrent new-key requests for one active server/edition/parsed name now produce one saved enrollment and explicit `ENROLLMENT_PENDING`/409 conflicts. Original UUID replay retains its receipt and expiry under current authorization. New keys after expiry can create a fresh pending row; history, audit/outbox and false identity/access are preserved. No inferred account equivalence, case folding or new schema is introduced. ADR 0028 records compatibility and transaction/index choices.

## Working tree

Task-owned domain/tests and linked documents are committed together. The pre-existing full-project review and unrelated backlog/status review hunks remain staged and excluded. Inspect `git status --short`; do not discard that work or claim the entire tree clean.

## Checks and evidence

Exact workspace and isolated-publication commands/results are recorded in the [build log](../build-log.md). Real database cases cover eight concurrent distinct keys, original receipt replay, unchanged audit/outbox/history, expiry, different actors/servers/editions, parsed trimming and API 409/202 behavior. Production/real game/client evidence remains unexecuted. Existing pinned toolchain and local disposable databases only.

## Decisions and blockers

Exact metadata deduplication is not identity verification. Variants, ownership/link changes and real account verification remain bridge work. Existing scoped transaction locks serialize new keys and the scoped expiry index bounds active candidates. Retention/archival and chronological pagination remain open. Chapter 04 and production remain gated; local F2/F25/F3 remains authorized.

## Next action

Implement stable newest-first enrollment history pagination with the existing scoped UUID cursor resolved to its immutable timestamp/ID anchor. Verify equal timestamps, multiple pages, concurrent arrivals and foreign cursor denial without losing or deleting history. Publish the next coherent checkpoint after checks.
