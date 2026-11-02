# CraftLayer Hosts checkpoint handoff

**Date:** 2026-11-02 UTC. **Agent/session:** Codex. **Branch/base/head:** main, backend base `8b4ac46`; checkpoint B publication follows this record. **Authorized scope:** local F2/F2.5/F3 capability development. No Contabo connection/install, production write, EULA acceptance or game/world operation.

## Current state

CL-F25-01 A/B provides adult-scoped certificate/key enrollment, private signed mTLS heartbeat, rotation/revocation, selected Docker inventory and `/nodes` dashboard. The separate prototype at http://127.0.0.1:3001/nodes has a real local Docker agent connected. Its two Minecraft server observations remain synthetic. Private sign-in/config/state stays under ignored `.craftlayer-prototype/`; [prototype guide](../../development/prototype.md) documents commands, explicit identity renewal and limits. The foreground agent and headed `agent-browser` session `craftlayer-prototype` are intentionally left for user testing. The local gateway was stopped/restarted during a read-only reconnect drill; all game containers/worlds and the main installation remained untouched.

## Working tree

Publish only this task's UI, transport/reconnect/time-window/inventory fixes, optional gateway, local fixture renewal, browser harness and related docs. Preserve five entry-dirty CL-03-07 files: runtime events/models, local secret checker, runtime stack harness, auth integration tests. Also preserve concurrent review edits in shared backlog/status and untracked `docs/reviews/full-project-review-2026-11-02.md`; they are excluded. Selectively stage our appended backlog/status checkpoint from HEAD, not those review hunks. Compare entry hashes and actual remote main after push; whole-tree cleanliness cannot be claimed while preserving this work.

## Checks and evidence

Exact final commands/results are in [build log](../build-log.md). Production-image disposable browser tests exercise actual mTLS and canonical parent API but synthetic capacity; ordinary child/viewer/tenant denial, rotation/revocation, mobile/keyboard and prior server flows pass. The running prototype additionally queried the actual local Unix Engine socket and recovered from gateway stop/start without resetting sequence. Neither proves full host capacity, physical command fences, Minecraft clients, backup/restore, remote entry or production readiness. Ignored screenshots/logs contain only synthetic/local observations; never commit browser auth/config/private keys.

## Decisions and blockers

[ADR 0019](../../architecture/decisions/0019-private-node-trust.md) retains all release gates. Local CA/server fixtures expire in two days and client credentials in 24h; explicit `prototype:node:renew` replaces/revokes a client identity, never extends expired trust or renews the CA. Crashed journal locks need operator review. Docker socket compromise remains host compromise. Production PKI/installer/private-network/MFA, native service port checks, hard disk quotas and real F2 identity/recovery are open. An asynchronous request for read-only production inspection/SSH target is pending; elapsed time is not approval. Do not connect without an explicit answer/target.

## Next action

Continue authorized CL-F25-02 with strict Family Survival template/dry-run planning: current adult node placement/provision permissions, fresh scoped capacity, immutable pinned artifact identity, EULA false, exact rejected/unknown gates and no physical effects. Then add transactional reservations and a narrow signed broker with effect journal/lease/fencing, ownership-safe rollback and isolated fault tests. Do not enable live provisioning by treating a plan or fake test as F2/F25 acceptance. CL-F25-01 remains incomplete for physical command authority; production actions remain separately gated.
