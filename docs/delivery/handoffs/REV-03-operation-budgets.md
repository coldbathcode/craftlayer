# CraftLayer session handoff — rolling operation budgets

**Date:** 2026-11-03 UTC. **Agent/session:** Codex. **Branch/base:** main / `68e15f9`. **Scope:** authorized local REV-03/A metadata reliability maintenance; no live host/world or chapter advancement.

## Current state

Operation admission uses 10,000/environment per rolling 24 hours plus existing twelve actor/environment/minute, under current scope/transaction/barrier/fence rules. Compatible MANAGEMENT_LIMIT/429 identifies minute/day retry guidance. UUID replay consumes no capacity or source read. History/audit/outbox and interrupted recovery-required records remain intact. [ADR 0028](../../architecture/decisions/0028-rolling-management-admission.md) explains changed storage tradeoff and scope.

## Working tree

Preserve five CL-03-07 runtime/test files, full-project review and concurrent review backlog/status hunks. Task-only publication verifies hashes/HEAD/remote; whole tree retains eight staged preserved paths. No secret/config/user installation change.

## Checks and evidence

Isolated offline install, `pnpm check` (355 unit cases) and `pnpm test:db` (167 integration cases plus migration proofs) PASS/0. Two new DB cases seed 10,000 old/full-window operations, prove refusal/replay/window expiry/source-read counts and retain every row/old operation. Initial fixture URL type narrowing corrected. No UI/schema change; no browser/full web build rerun, strict server builds included. Exact commands/results in [build log](../build-log.md).

## Decisions and blockers

This is admission reclaim, not retention or recovery. History grows; audited retention/archival/storage monitoring remains. Enrollment's 200-row lifetime ceiling/deduplication remains open, so REV-03 is not wholly closed. Actual family/production qualification and private node composition remain gated.

## Next action

Count only unexpired pending requests against the 200/server enrollment budget; preserve immutable request/operation/audit history, expiry semantics and current-auth replay. Test expired history, full active budget, replay and later admission on a disposable DB. Name requests must remain unverified and grant no access. Then semantic deduplication/retention and authorized runtime qualification can continue independently.
