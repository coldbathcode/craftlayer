# CraftLayer session handoff — CL-03-07

**Date:** 2026-11-03 UTC. **Agent/session:** Codex. **Branch/base/head:** main, base `8ff2a69`, head is the commit containing this handoff. **Authorized scope:** Chapter 03 and local F2/F25/F3, task commits/pushes. No Chapter 04 or production authority.

## Current state

Chapter 03 is locally verified 7/7 with [review prepared](../../reviews/03-fleet-engine.md); owner acceptance remains pending. The previously preserved runtime/test implementation is now deliberately included, with paired mission/event permission guards avoiding nested identity leases. Database and real disposable stack fault evidence covers races, budget/approval denial, Redis loss, restart, prepared crash and watchdog/reconciliation. The workspace simulation partition measured 611 ms against 20,000 ms; no physical adapter guarantee.

## Working tree

Task-owned runtime/test and linked documentation changes are published together. The pre-existing full-project review document and unrelated status/backlog review hunks remain preserved and excluded; a whole-tree clean claim is therefore unavailable. Do not discard or silently publish that review. Inspect `git status --short` before the next step.

## Checks and evidence

Workspace `pnpm check` PASS/0 (355 unit tests), `pnpm test:db` PASS/0 (174 tests plus migration proofs), `pnpm test:runtime-stack` PASS/0. The isolated publication snapshot passed the same commands/counts with a 669 ms simulation partition acknowledgement and completed fixture cleanup; see the [build log](../build-log.md). Tools/fixture versions and test scope are in the chapter review. No new hosted CI, real provider/game/VPS test or production restore is claimed.

## Decisions and blockers

ADR 0014 retains explicit simulation limits, durable stop and unknown-effect holds. Separate `event:read` is required alongside mission scope, including custom roles. No schema migration or new grant bypass is introduced. Chapter 04 needs authorization; local F2/F25/F3 remains available. Real identity/access/approval/storage/game/recovery gates are still open.

## Next action

Inspect current F2 enrollment domain/tests and ADR 0028. Add semantic deduplication for an already-active pending identity request without treating metadata as verified identity or altering audit/history. Keep current-authority idempotent replay, tenant/server scoping and truthful operation responses. Test, document, commit/push and verify actual remote main before the next checkpoint.
