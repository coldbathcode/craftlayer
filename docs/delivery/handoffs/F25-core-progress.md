# Node execution and reservation progress handoff

**Date:** 2026-11-02 UTC. **Session:** Codex, continued local plan. **Branch/base/head:** main, entry `4d1d53e`, signed executor `c13d7a0`; reservations `11499b2`, fixed Engine `38faeb5`; ownership publication follows this record. **Authorized scope:** continue local F2/F2.5/F3 checkpoints with commit/push per step; no Chapter 04 or production host/world access.

## Current state

CL-F25-01/C implements the private signed local executor, online nonce permits, durable intent/fences/stop/receipts and conservative uncertainty. It is not wired to inventory transport or an effect endpoint. CL-F25-02/B adds private SQL 0020/Drizzle reservation service, current dual adult scope, qualified-admission port, atomic port/capacity/operation/audit/outbox, expiry only before dispatch and retained allocated/uncertain claims. The admission/independent approval/host qualification adapter defaults unavailable and has no production implementation. CL-F25-02/C adds the fixed private Engine policy/helpers and fifteen recording tests; checkpoint D adds the durable private ownership/intent/ID/lifecycle/rollback runner and thirteen fault/receipt cases. No real Docker effect or public path yet. [Execution](../../development/node-execution.md), [reservation runbook](../../development/node-reservations.md), ADRs 0020/0021 and status are current. F2 real identity/backup/recovery remains open.

## Working tree

Preserve five CL-03-07 files unchanged/excluded: runtime events/models, local secret checker, runtime stack harness and auth integration test. Also preserve concurrent backlog/status review hunks and untracked full-project review. Entry hashes for this continuation are in `/tmp/craftlayer-execution-entry.json`. Stage only our appended shared-doc checkpoint from HEAD; never publish or erase other work to manufacture a clean tree. Task-only HEAD/actual remote equality is verified after each push; whole-tree cleanliness remains unavailable for preserved work.

## Evidence

Exact commands/results are in build log. Signed execution has ten fake-port/process-kill tests; no Docker effect. Reservation suite uses a fourth disposable PostgreSQL database, eleven concurrency/authorization/retention cases and migration proofs; admission/approval is explicitly fake. No real disk quotas, complete Minecraft image, licensed client, backup/restore or production evidence is implied. Existing prototype :3001 remains separate with inventory/planner; older :3000 was already stopped and was not restarted. Never print/commit ignored prototype credentials, browser state or private signing/TLS keys.

## Decisions and blockers

No public effect path is enabled. Journal metadata bounds (128/512 KiB), archival, current authority/approval/stop transport and evidence-bound reconciliation remain gates. Allocated/uncertain reservations cannot ordinary-release, including after expiry. Any future runtime removal must retain and account for world/backups separately. The asynchronous read-only Contabo approval/SSH target remains unanswered; broad continued coding is not production access. Local TLS fixtures expire in two days/credentials in 24h; preserve their explicit renewal rules.

## Next action

Exercise the durable ownership runner on an explicitly disposable local non-Minecraft fixture for real create/start/stop/rollback proof; no EULA or real world. Recording Engine fault/real child-process death tests are implemented. Then add durable controller jobs/permit transport within the same authorization. Actual persistent quota/host qualifier and production command dispatch stay blocked until qualified. Continue authorized local checkpoints and publish each; do not substitute a test fake for the production authority/admission adapter.
