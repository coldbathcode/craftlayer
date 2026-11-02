# CraftLayer F2 prototype handoff

**Date:** 2026-11-02 UTC. **Agent/session:** Codex, F2 local continuation. **Branch/base/head:** main; F1 base `9ca90cd`, checkpoint A `e9c7ddd`; checkpoint B commit follows this record in Git. **Authorized scope:** local F2; user prioritised a runnable prototype. No Contabo, live world, public deployment or paid inference.

## Current state

A separate prototype is running on http://127.0.0.1:3001/servers, with generated parent/viewer/child accounts and two clearly simulated servers. Private credentials are in `.craftlayer-prototype/START-HERE.md`; never print or commit them. A headed `agent-browser` session named `craftlayer-prototype` was opened for local testing and is intentionally left available to the user. [Prototype guide](../../development/prototype.md) describes commands and first test journey.

CL-F2-01 checkpoint A adds pinned unqualified artifacts, provenance/mapping helpers and strict request schemas. Checkpoint B adds additive migration 0017, current scoped pending request API/SDK and Players & access UI, UUID replay/current auth, immutable pending state and atomic audit/reference-only outbox. Requests persist but cannot authenticate identities or grant access. Candidate artifacts stay non-runnable/EULA false. No actual Minecraft server was booted or connected. [Progress review](../../reviews/F2-family-access.md) is explicitly incomplete.

## Working tree

Task-owned files must be committed/pushed and clean at publication. Preserve these five unrelated entry-dirty files unchanged and excluded: `packages/runtime/src/events.ts`, `packages/runtime/src/models.ts`, `scripts/check-local-secrets.mjs`, `scripts/test-runtime-stack.mjs`, `tests/integration/auth.integration.test.ts`. They belong to open Chapter 03 work. Hash comparison and local/actual remote equality are verified in session after publication; a completely clean tree cannot be claimed while preserving them.

Ignored `.craftlayer-prototype/` contains newly generated secrets/state/inventory/browser artifact files only; it is excluded from Git and Docker build context. Prototype Compose volumes are separate and retained by `prototype:down`. Do not reset/delete them or overwrite user prototype requests without instruction. The existing local installation’s `.env`/accounts/volumes and live worlds remain unchanged. Preparation also retained task-created temporary official candidate artifacts with `.part` suffixes and EULA false; no real world content is present.

## Checks and evidence

Exact final results are in [build log](../build-log.md) and [progress review](../../reviews/F2-family-access.md). Disposable database/API and isolated browser tests do not touch the persistent prototype or main stack. Actual prototype parent request `PrototypeTry` was saved, shown pending, and inspected through the headed browser; synthetic only. Browser screenshots stay ignored. Host tooling checks/pins a local Unix Docker socket and rejects SSH/TCP contexts before mutation, including after context changes. No hosted clean-commit CI, real game/client/restore or Contabo proof is claimed.

## Decisions and blockers

ADR 0018: structural evidence normalization is not authentication, web ownership or admission; Java/Bedrock subjects never merge from names/shared linked UUIDs. Only the future authenticated pinned bridge and explicit adult binding can advance this workflow. Requests are immutable pending/expired metadata, with a 200/server retention cap; operation success means saved only. Remote management remains blocked pending private entry/MFA. Real licensed client availability has been requested; no credentials were requested or collected. EULA acknowledgement and reviewed isolated game/bridge configuration are needed before future runtime tests.

## Next action

Continue **within authorized F2/CL-F2-01** with a typed authenticated bridge and explicit adult-to-game account binding. Inspect current Git/status/ADR 0018 and [identity qualification matrix](../../development/minecraft-identities.md); preserve the running prototype for user feedback. Prove actual pinned Java/Bedrock rejection/admission/rename/spoof/link behavior with approved test clients before closing MC-03 or proceeding to mutable allowlists. CL-F2-02–04 remain open; F2.5/F3 need separate chapter authorization. Do not silently convert prototype success into family/production readiness. CL-03-07 remains separately open/authorized.
