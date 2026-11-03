# CraftLayer session handoff — F2.5 node polling

**Date:** 2026-11-03 UTC. **Agent/session:** Codex. **Branch/base:** main / `e0b70c0`. **Scope:** authorized local CL-F25-03/H; production/VPS/game/world/EULA remains unauthorized.

## Current state

Optional private fixed mTLS polling returns one signed exact assigned ID/hash/expiry. Current node/key/certificate/scope/control/policy/heartbeat/stop checks apply, with request-digest binding and five-second bounded read-only nonce cache. Node verifies pinned TLS/controller/signature/scope/lifetime. Polling grants no effect authority; revoked human fetch/permits still deny. Installed main/Compose remains inventory-only. See [ADR 0026](../../architecture/decisions/0026-deployment-background-dispatch.md) and [runbook](../../development/deployment-jobs.md).

## Working tree

Preserve six staged runtime/test/review files plus two shared review-document diffs. All task changes publish separately and HEAD/remote equality is verified. Whole-tree cleanliness cannot be claimed because preserved edits remain staged. No user installation/secret/volume changed.

## Checks and evidence

Isolated `pnpm install --offline --frozen-lockfile`, `pnpm check` (351 unit cases/41 files) and `pnpm test:db` (164 cases/seven files plus migration proofs) PASS/0. Four new DB/network/two contract cases and updated real native TLS/scratch-Redis discovery journey pass. Qualification/approval remains explicit fake; no game identity/storage/recovery or deployed isolation proof. Exact commands/corrections are in [build log](../build-log.md). No UI/browser changes.

## Decisions and blockers

Read-only nonce cache is ephemeral/bounded; restart may repeat an authenticated read, never an effect. New client nonce/digest cannot accept stale responses. Physical command/permit replay and uncertainty remain durable. Original current human dual grants and qualification are checked at fetch/permit, independent of polling. Real credential composition, approval/storage/game/recovery sources, archival and evidence-bound reconciliation remain open.

## Next action

Compose a bounded node runner with the private executor/journal and fixed command transport. Drain and durably acknowledge retained signed receipts before accepting more work; lost response or reconnect cannot fetch/execute again as a delivery retry. Preserve stop and unresolved native intents. Continue local F2.5 checkpoints, with separate commits/pushes; production and Chapter 04 remain gated.
