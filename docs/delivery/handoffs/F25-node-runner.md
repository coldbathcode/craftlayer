# CraftLayer session handoff — F2.5 node runner

**Date:** 2026-11-03 UTC. **Agent/session:** Codex. **Branch/base:** main / `0e59acc`. **Scope:** authorized local CL-F25-03/I and subsequent local checkpoints; no production/VPS/game-world/EULA operations.

## Current state

Private runner drains bounded durable signed receipts before discovering/executing another command. Exact acknowledgements are synced locally; lost acknowledgement/reopen replays only settlement metadata after expiry/revocation. Stops, disabled policy, receipt backlog and unresolved native resources block new work. Local execution journal v2 atomically upgrades strict v1, preserving signed evidence/fences/world bindings/stops/version floors. Older readers require forward correction, never journal reset. See [ADR 0027](../../architecture/decisions/0027-node-receipt-delivery.md), [controller runbook](../../development/deployment-jobs.md), [progress review](../../reviews/F25-secure-nodes.md).

## Working tree

Preserve five CL-03-07 runtime/test files, full-project review and concurrent backlog/status review hunks; task-only publication excludes them. Verify hashes and HEAD/remote equality. Whole tree stays dirty only for preserved staged work. No existing installation, credentials or world/volume touched.

## Checks and evidence

Exact final commands/results are in [build log](../build-log.md). Four new real-file executor/runner cases cover loss/reopen after expiry/revocation, stop-safe evidence delivery, contradictory acknowledgement refusal/uncertain-resource blocking and v1 migration. Native disposable DB/remote-authority/mTLS/Docker journey drops a response after actual controller settlement, reopens the node executor and drains without another create. Qualification/approval remains explicitly fake; no Minecraft identity/quota/backup/restore proof. No UI/browser changes.

## Decisions and blockers

Acknowledgement marks delivery only, never clears native uncertainty or frees journal slots. Pending old-credential/policy evidence needs explicit recovery; drain before planned rotation. Existing 128-command/512 KiB limits remain. Installed main/Compose execution, independent adult approval/real storage/game qualification, archival and evidence-bound reconciliation remain open. Abort during an effect waits for the executor's bounded durable result and retains pending evidence; it does not clear stop or assume cancellation of daemon work.

## Next action

Continue local private composition/credential recovery and real approval/storage/game/backup/restore qualification. Preview correctness/security review findings may be addressed independently while actual client/host evidence waits. Inspect current status first; separate commits/pushes per completed checkpoint. Chapter 04 and production require separate authorization.
