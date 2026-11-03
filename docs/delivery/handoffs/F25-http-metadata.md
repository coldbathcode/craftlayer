# CraftLayer session handoff — F2.5 HTTP metadata

**Date:** 2026-11-03 UTC. **Agent/session:** Codex. **Branch/base:** main / `82f46c7`. **Authorized scope:** CL-F25-03/F local capability development, completing unfinished HTTP/SDK work. No VPS access, production deployment, EULA, real world changes or paid inference.

## Current state

Local API exposes key-free metadata admission plus current adult dual-scope admission/job reads and generic operation resolution. SDK uses existing same-origin bounded transport/shared schemas. Required UUID headers/strict body, Origin/CSRF, original actor/session, redaction, expiry/replay and remote-entry blocking apply. API readiness requires SQL 0023 storage. Node/gateway remains inventory-only in installed configuration. See [controller runbook](../../development/deployment-jobs.md) and [F2.5 progress review](../../reviews/F25-secure-nodes.md). This checkpoint is implemented locally, not chapter acceptance or game readiness.

## Working tree

Task includes the pre-existing unfinished API/SDK/admission changes, new controller API integration tests and linked chapter/architecture/runbook/risk/status/backlog/build-log evidence. Preserve five CL-03-07 runtime/test files (`packages/runtime/src/events.ts`, `packages/runtime/src/models.ts`, `scripts/check-local-secrets.mjs`, `scripts/test-runtime-stack.mjs`, `tests/integration/auth.integration.test.ts`), full-project review file and its concurrent backlog/status review hunks. They are excluded from this publication; whole-tree cleanliness is unavailable. Check entry hashes before handoff.

## Checks and evidence

Isolated task-only snapshot: `pnpm install --offline --frozen-lockfile`, `pnpm check` (349 unit cases/40 files), `pnpm build` and `pnpm test:db` (156 integration cases/seven files plus migration proofs) all PASS/0. Original workspace `pnpm compose:check` PASS/0. Final `pnpm docs:check` and `git diff --check` PASS/0. Exact results and the corrected initial failed test are recorded in the [build log](../build-log.md). Three new real DB/API cases cover HTTP/SDK/operation permission and current revocation, strict metadata, concurrent replay/atomic records, OpenAPI, actual loopback SDK network reads/receipt state, default qualifier refusal, remote blocking, expiry and retained allocations. Prepared reservations/approval/qualification are explicitly fake. Existing real TLS/Redis fixture is separate from game identity/recovery proof. No UI changes or browser rerun; no existing installation migration/restart.

## Decisions and blockers

ADRs 0024–0025 and existing qualification/recovery gates remain. Historical unexpired authority cannot replace fresh execution checks; metadata success is not an independent adult approval. API acquires no node-control key/Docker; installed gateway acquires no identity secrets. No background effect wiring, public job-issuance route or arbitrary node command. Allocations remain retained, including after expiry/receipt/rollback, until evidence-bound reconciliation exists. Production private-entry/MFA, world quotas, real identity/access, consistent backups and isolated restore remain incomplete.

## Next action

Implement bounded gateway-side reference-only outbox dispatch/polling and expiry handling, under remote current authority and default-unavailable qualification; test crash/restart/replay without renewing or taking over uncertain commands. Read `docs/delivery/status.md`, controller runbook, ADRs 0024–0025 and deployment-job tests first. This remains inside authorized local F2.5; Chapter 04 and all production operations require separate authorization. Publish each coherent checkpoint independently.
