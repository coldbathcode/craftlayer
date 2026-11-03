# CraftLayer session handoff — F2.5 background dispatch

**Date:** 2026-11-03 UTC. **Agent/session:** Codex. **Branch/base:** main / `d022525`. **Authorized scope:** continue local F2/F2.5/F3 checkpoints with separate task commits/pushes. No production/Contabo/game-world/EULA authorization.

## Current state

CL-F25-03/G adds private bounded authority-outbox scans, current sealed-authority issuance, rotating cursor fairness and a sequential cancellable loop. Duplicate/lost-ack/reopened scans rely on unique durable job links, never physical retries or lease renewal. Denial-only expiry verifies this controller's retained signature, marks overdue issued jobs uncertain and retains allocation/ports even after actor revocation. Installed entrypoints stay inventory-only. See [ADR 0026](../../architecture/decisions/0026-deployment-background-dispatch.md), [runbook](../../development/deployment-jobs.md) and [progress review](../../reviews/F25-secure-nodes.md).

## Working tree

Preserve the five staged CL-03-07 runtime/test files and full-project review, plus its staged backlog/status hunks. Publish only this task. Validate protected hashes and actual HEAD/remote equality; whole-tree clean is unavailable for preserved edits. No existing installation config/volumes/secrets changed.

## Checks and evidence

Exact final commands/results and corrections are in the [build log](../build-log.md). Four new real DB cases cover concurrent/reopened/lost-ack issuance and cancellation; default-unavailable qualification, revoked authority and forged scope/page bounds; bounded cursor fairness; signature-bound concurrent expiry/retained resources/late evidence. Existing native DB/remote-authority/TLS/scratch-Redis journey starts with the dispatcher. Test qualification/approval remains fake; no Minecraft readiness or restoration proof. No UI/browser changes.

## Decisions and blockers

Current actor/grants, stop, policy and independent qualification still gate every issuance. Expiry is only denial metadata and cannot release/retry work. No new schema, public route, Redis consumer or installed effect path. Private credentials/composition, signed node polling, real approval/storage/game/recovery sources and evidence-bound reconciliation/archival remain incomplete. Family/production readiness remains blocked by the original gates.

## Next action

Add fixed signed node polling of at most one exact issued job/hash under pinned mTLS and current node/key/scope/stop checks. Poll discovery must grant no effects or lease extension; command fetch/permits retain all current human/qualification checks. Then add bounded node orchestration and private installed composition without identity/control credential co-location. Continue authorized local checkpoints; Chapter 04 and production require separate approval.
