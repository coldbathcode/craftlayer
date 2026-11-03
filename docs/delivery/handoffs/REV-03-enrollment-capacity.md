# CraftLayer session handoff — pending enrollment capacity

**Date:** 2026-11-03 UTC. **Agent/session:** Codex. **Branch/base:** main / `72e00aa`. **Scope:** authorized local REV-03/B; no production/world or later chapter advancement.

## Current state

Only unexpired requests count against 200/server. Immutable expired requests and original operation/audit/outbox remain, replay keeps current authority/no extra slot, and names remain pending/unverified/no access. Additive SQL 0024/Drizzle provides scoped time-range indexes for rolling operation/enrollment budgets. Pre-management fixtures apply it after table creation. See [ADR 0028](../../architecture/decisions/0028-rolling-management-admission.md).

## Working tree

Preserve five authorized CL-03-07 runtime/test files, original full-project review and concurrent review backlog/status hunks. This publication excludes them and verifies hashes/HEAD/remote. Eight preserved staged paths prevent whole-tree cleanliness. No secret/world/config/user installation changed.

## Checks and evidence

Isolated offline install, `pnpm check` (355 unit cases) and `pnpm test:db` (169 integration cases plus migration proofs through SQL 0024) PASS/0. Two new DB cases cover expired-history admission, active refusal, current replay, later expiry/re-admission, retained rows and false identity/access without source queries. Main DB has four extra preserved runtime cases. No UI/browser/full web build rerun; server build included. Exact results in [build log](../build-log.md).

## Decisions and blockers

Storage history grows; semantic deduplication and audited retention/archival remain open. Expiry reclaims metadata slots only, never verified account authority or infrastructure. Real identity bridge/client/access/backups/restoration/private composition and production gates remain.

## Next action

Resume already-authorized CL-03-07: fix the preserved event-permission guard's nested identity pool acquisition using paired grant validation, add concurrent event-page evidence, pin the disposable runtime harness to a local Docker context and run actual restart/Redis-loss/crash/watchdog qualification. Publish that task's runtime files deliberately rather than continuing to classify them as unrelated. Retain the original review document and unrelated hunks; Chapter 04 still requires authorization.
