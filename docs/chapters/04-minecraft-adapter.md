# Chapter 04 — Minecraft adapter

**Status:** not started. **Specification:** ready for engineering review. **Implementation evidence:** none.

**Milestone:** M2. **Requirements:** PR-009–010; NFR-03–04.

Unified priority amendment: new bot work follows F0–F3 management and the Chapter 03 gate, then explicit Chapter 04 authorization. Reuse approved server/auth/plugin fixtures and registry; never recreate the adopted production server. See [track](../delivery/minecraft-track.md).

## Objective

Connect a bounded Mineflayer agent to a private Java world and execute deterministic safe movement and inventory/build primitives.

## Dependencies and entry gate

Chapters 00–03 accepted. Stop/watchdog, runtime interfaces and fake environment tests exist.

Before work: inspect Git status, read AGENTS.md and delivery status, confirm the authorized chapter scope, and inspect the previous review evidence. Do not assume a dependency is complete merely because its specification exists.

## Scope and implementation approach

Private server profile, compatibility/authentication spike, bot lifecycle, observations, pathfinding, inventory, region/action policy, block actions and reconciliation. Multi-bot army planning comes in Chapter 06.

Mineflayer is behind environment-minecraft. Runtime sends validated typed actions, not arbitrary chat/server commands. One active bot session per logical agent; reconnect reloads canonical stop/policy and observed world state.

Architecture references: [runtime-and-agents](../architecture/runtime-and-agents.md), [minecraft-cooperation](../architecture/minecraft-cooperation.md), [security-and-access](../architecture/security-and-access.md).

## Ordered engineering tasks

Each task is initially unchecked. Dependencies below describe the default conservative order; record an explicit justified dependency change before reordering. Task sizes are relative engineering complexity (M/L), not delivery dates.

### [ ] CL-04-01 — Server, protocol and authentication spike

**Depends on:** Chapter 03 gate. **Size:** L. **Status:** not started.

**Implementation:** Pin compatible Java server/Mineflayer/pathfinder versions and document a legitimate private bot login mode. Keep server private, PvP off, allowlist configured and license acceptance explicit.

**Required evidence:** A compatibility record demonstrates connect/disconnect on supported host architectures and documents auth constraints.

### [ ] CL-04-02 — Private world Compose profile

**Depends on:** CL-04-01. **Size:** M. **Status:** not started.

**Implementation:** Add persistent world/config volumes, memory/headroom limits, health checks, backup-friendly save controls and a reproducible seeded test world. Do not silently accept third-party terms.

**Required evidence:** World persists across restart; no accidental public port exposure; test seed/version recipe recreates fixture.

### [ ] CL-04-03 — Bot lifecycle and single-session ownership

**Depends on:** CL-04-02. **Size:** L. **Status:** not started.

**Implementation:** Implement start/observe/stop, death/kick/disconnect handling, bounded reconnect and per-agent session fencing. Pass cancellation/watchdog through all actions.

**Required evidence:** Repeated start/stop is safe; stale session disconnects; reconnect cannot bypass latched stop.

### [ ] CL-04-04 — Observation and navigation primitives

**Depends on:** CL-04-03. **Size:** L. **Status:** not started.

**Implementation:** Normalize position/health/hunger/inventory/block observations with bounds. Add approved-region pathfinding, hazard filters, chunk-load timeout and stuck detection.

**Required evidence:** Bot reaches permitted target, refuses forbidden regions/hazards and produces bounded failure when unreachable.

### [ ] CL-04-05 — Inventory and build action library

**Depends on:** CL-04-04. **Size:** L. **Status:** not started.

**Implementation:** Implement validated gather/dig/pickup/chest/placement primitives with allowed items, reach/preconditions, action receipts and postcondition checks. Keep server commands/operator privilege unavailable.

**Required evidence:** One bounded task completes and verifies actual inventory/block state; invalid item/region/player attack is denied.

### [ ] CL-04-06 — Disconnect and uncertain-effect recovery

**Depends on:** CL-04-05. **Size:** L. **Status:** not started.

**Implementation:** Reconcile actions interrupted after dig/transfer/place, renew valid reservations, release stale claims and prevent blind repeated effects. Integrate stop acknowledgement with physical bot quiescence.

**Required evidence:** Kill/reconnect around a placement does not duplicate or corrupt the target; stop timing measured while navigating/digging.

### [ ] CL-04-07 — Adapter contracts and safety review

**Depends on:** CL-04-06. **Size:** M. **Status:** not started.

**Implementation:** Run private-world contract tests, policy negatives, timeout/death/restart cases and secret/log review. Document auth setup, unsupported versions and troubleshooting.

**Required evidence:** Bot connects, moves, completes and verifies a task, stops by deadline and preserves world through restart.

## Test plan

- Connection rejected, incompatible protocol, death, kick, chunk timeout and reconnect exhaustion.
- Disallowed world/region/material/action/player target; untrusted chat injection ignored.
- Interrupted place/dig/chest transfer reconciles against observed state.
- Pause/stop while pathfinding and DB/network partition with active bot.

Use deterministic/fake services first. Any live inference, public deployment, publication or payment action needs existing user authorization for that action; local tests must not silently use real keys. Record exact commands, versions, fixture seeds and exit results. An unavailable dependency is unverified/blocked, not passed.

## Security considerations

- No operator permissions or public server assumptions.
- Authentication tokens protected; private/offline test mode, if chosen, cannot be exposed to untrusted networks.
- World/chat data is private and never treated as higher-priority instructions.

## Acceptance criteria

- [ ] Private test world and supported authentication path are reproducible.
- [ ] Bot completes a deterministic action with independent world/inventory verification.
- [ ] Stop and reconnect honor current scope/grant and no PvP/player attack is possible.
- [ ] Required tests pass, relevant documentation is updated, and no unreviewed safety regression remains.
- [ ] Every completed task points to concrete evidence; deferred checks are explicitly listed with impact.

## Demonstration and independent verification

Connect one bot, move to an allowed coordinate, place/verify one block, demonstrate forbidden action denial and Stop All.

## Documentation and deliverables

Minecraft adapter/action schemas; pinned server fixture/profile; auth/compatibility notes; live local contract evidence.

Update the OpenAPI/SDK or configuration reference when changed, add migrations/compatibility notes, and capture limitations. Use a dedicated chapter review document based on [the review template](../templates/chapter-review.md). Do not edit the original source blueprint.

## Review checkpoint and next handoff

Fill the chapter review with implementation summary, task/requirement mapping, checks, security evidence, benchmark results where relevant, known issues and next steps. Update [status](../delivery/status.md), [backlog](../delivery/backlog.md) and [decisions](../delivery/risks-and-decisions.md) together. A chapter is accepted only when its acceptance evidence is reviewed.

Complete the authorized scope before asking for the next chapter. Default chapter-by-chapter authorization follows the blueprint; an explicit user instruction authorizing multiple chapters overrides that default. Use [the handoff template](../templates/agent-handoff.md) so the next session can resume without reconstructing context.
