# CraftLayer session handoff — CL-F25-03/K1

**Date:** 2026-11-04 UTC. **Agent/session:** Codex. **Branch/base:** main, `c353a47`. **Authorized scope:** local F2/F25/F3 and task commits/pushes; no Chapter 04, production or live world action.

## Current state

Completed the pre-existing unfinished `AuthService.guardIndependentExecutions` implementation. Two distinct adults' sealed grants now share one identity transaction, use stable principal lock ordering and retain caller order. Current user/session/membership/canonical scope and permissions apply to every grant; a final all-principal deadline/issue-time check denies expiry or clock rollback while waiting for locks. Single-principal child-safe reads remain supported. No approval decision, deployment qualifier or installed execution route is added. [ADR 0030](../../architecture/decisions/0030-durable-deployment-review-requests.md).

## Working tree

Auth implementation is intentionally adopted as task-related work, with regression tests and linked documentation. Pre-existing staged `docs/reviews/full-project-review-2026-11-02.md` and its backlog/status review hunks are preserved and excluded from publication. No credentials, private fixtures or worlds are committed. See build log for publication verification; do not claim whole-tree cleanliness while this review remains staged.

## Checks and evidence

Exact commands/counts and the initial strict test-typing correction are in the [build log](../build-log.md). Eleven new real database cases cover twelve concurrent reversed pairs, caller order/expiry bounds, same-user different sessions, mixed sessions, malformed/tampered/foreign grants, child exclusion with preserved single-principal reads, both-side session and membership revocation, explicit reviewer approval scope and real lock-wait expiry/clock rollback. Tests use disposable PostgreSQL; no game, production or approval-composition evidence is implied.

## Decisions and blockers

The identity primitive requires callers to select every required permission, bind original/reviewer identities to the exact request and apply canonical review/stop/node checks. Callbacks must not obtain another identity lease and must bound downstream writes by the minimum authority deadline. Identity locks do not freeze time or make another database transaction atomic. Durable independent decisions and actual host/game/recovery qualification remain open.

## Next action

Implement exact-review decisions, rejection and revocation in `DeploymentAdmissions`, using original placement/provision plus reviewer placement/provision/approval grants with this paired guard. Persist immutable decision evidence and revalidate current original/reviewer authority before use. Keep initial reservation admission and actual host/storage/game/identity/recovery qualification separate, absent adapters denied and installed entrypoints inventory-only. This remains within authorized F25 local work; Chapter 04 and production require separate authorization.
