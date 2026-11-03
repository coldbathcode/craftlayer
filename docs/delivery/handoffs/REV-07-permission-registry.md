# CraftLayer session handoff — permission registry parity

**Date:** 2026-11-03 UTC. **Agent/session:** Codex. **Branch/base:** main / `9091bf7`. **Scope:** authorized local management/security maintenance REV-07; no production or later chapter advancement.

## Current state

Canonical organization permissions type-check built-in role/delegation literals with `satisfies`, retaining literal names/tuples. Actual migrated SQL permission IDs and built-in role pairs must exactly match TypeScript. Existing policy/grants/child behavior and SQL migrations remain unchanged. The check detects drift; it does not certify the intended policy or close the child own/preset-mission finding.

## Working tree

Preserve six runtime/test/review files plus two concurrent review-document hunks. Task-only publication excludes them and verifies hashes/HEAD/remote. The original unpublished review table retains its historical state; appended implementation evidence is authoritative for this follow-up. No secret/config/world data changed.

## Checks and evidence

Isolated `pnpm install --offline --frozen-lockfile`, `pnpm check` (355 unit cases/41 files) and `pnpm test:db` (165 cases/seven files plus migration proofs) PASS/0. New parity regression uses the actual prior-schema-upgraded management DB; all seed values match. Original workspace DB has four extra unpublished runtime cases, separately preserved. No UI/browser or full web build rerun; strict server build is part of check. Exact results are in [build log](../build-log.md).

## Decisions and blockers

Future permission changes require an additive migration and matching canonical registry update. Do not rewrite historical migrations or widen grants solely to satisfy a parity check. Child own/preset scope, trusted proxy, retention and other review findings remain separate. Family/production qualification remains open.

## Next action

Address REV-03's lifetime management-operation counter using bounded rolling admission windows and real DB expiry/history/minute-budget tests. Preserve all operation/audit/outbox history; audited archival and enrollment limits/deduplication are separate follow-ups. Continue authorized local checkpoints with independent commits/pushes; no live host/world or Chapter 04 action.
