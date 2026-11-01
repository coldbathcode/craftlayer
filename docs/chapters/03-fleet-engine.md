# Chapter 03 — Fleet engine

**Status:** in progress; user authorized Chapter 03. **Implementation evidence:** [build log](../delivery/build-log.md).

**Milestone:** M1. **Requirements:** PR-007–009, PR-017, PR-021; NFR-02–05.

## Objective

Build a recoverable fleet and mission engine with finite DAGs, bounded agent execution, authorized events and a persistent emergency stop.

## Dependencies and entry gate

Chapters 00–02 accepted for advancement (implementation review, not independent security certification). Tenant auth, provider routing, ledger and durable DB are available.

Before work: inspect Git status, read AGENTS.md and delivery status, confirm the authorized chapter scope, and inspect the previous review evidence. Do not assume a dependency is complete merely because its specification exists.

## Scope and implementation approach

Agents/groups/templates/missions/tasks, scheduler, outbox, BullMQ dispatch, execution grants, worker identity, leases/fencing, retries/reconciliation, approvals primitive, API/events and initial CLI.

Use DB state machines, an at-least-once queue, outbox and typed adapter interfaces. Start with a deterministic fake environment so distributed behavior is verified before game integration.

Architecture references: [runtime-and-agents](../architecture/runtime-and-agents.md), [api-and-events](../architecture/api-and-events.md), [data-model](../architecture/data-model.md).

## Ordered engineering tasks

Each task is initially unchecked. Dependencies below describe the default conservative order; record an explicit justified dependency change before reordering. Task sizes are relative engineering complexity (M/L), not delivery dates.

### [x] CL-03-01 — Domain schema and finite state machines

**Depends on:** Chapter 02 gate. **Size:** L. **Status:** verified; see build log.

**Implementation:** Implement fleet/mission/task tables, versioned template snapshots, transition rules and DAG validation. Define required/optional outcome rules and bounded graph/tool limits.

**Required evidence:** Cycles, cross-mission edges, invalid states and oversized graphs reject; valid deterministic mission reaches success.

### [x] CL-03-02 — Mission API, grants and CLI

**Depends on:** CL-03-01. **Size:** L. **Status:** verified; see build log.

**Implementation:** Add scoped fleet/template/mission commands, execution grants, optimistic versions, idempotency keys and typed SDK/CLI. Persist actor authority for worker revalidation.

**Required evidence:** Duplicate execute submits one logical execution; CLI permissions match API; revoked creator cannot execute queued work.

### [ ] CL-03-03 — Outbox and fair scheduler

**Depends on:** CL-03-02. **Size:** L. **Status:** not started.

**Implementation:** Implement atomic state/audit/outbox writes, publisher retries, organization fairness, capacity quotas and missed-dispatch reconciliation. Make scheduler leadership/leases explicit.

**Required evidence:** Crash between commit/publish and duplicate relay produces one durable task result; org cannot starve peers.

### [ ] CL-03-04 — Worker claims and bounded runtime

**Depends on:** CL-03-03. **Size:** L. **Status:** not started.

**Implementation:** Authenticate org-bound workers, claim tasks atomically, increment fence, heartbeat leases, validate structured tool proposals and enforce deadlines/cancellation. Keep model loops bounded.

**Required evidence:** Concurrent claims, stale worker commits, invalid model tools and old protocol versions cannot execute unauthorized results.

### [ ] CL-03-05 — Pause, cancel and emergency stop

**Depends on:** CL-03-04. **Size:** L. **Status:** not started.

**Implementation:** Add latched scope epochs, no-new-dispatch rules, stop operation acknowledgement/quiescence, local watchdog and explicit clear/resume. Use fake adapter to model uncertain effects.

**Required evidence:** Stop persists through restart; partitioned worker ceases effects by deadline and late results are rejected.

### [ ] CL-03-06 — Authorized event projection and recovery

**Depends on:** CL-03-05. **Size:** L. **Status:** not started.

**Implementation:** Implement cursor events, WebSocket/SSE projection, bounded buffers, revocation and replay/resync. Recover expired tasks, uncertain effects and dispatch after Redis loss.

**Required evidence:** Foreign cursors/channels deny; reconnect deduplicates and snapshots; Redis loss recovers without mission loss.

### [ ] CL-03-07 — Runtime fault suite and review

**Depends on:** CL-03-06. **Size:** L. **Status:** not started.

**Implementation:** Run claim/replay races, kill points around effects, provider/budget/approval blocks, stop partitions and restart tests. Document state transitions and operational commands.

**Required evidence:** No duplicate committed result across 100 claim/replay attempts; all stop and recovery evidence attached.

## Test plan

- Crash before dispatch, after claim, after external effect and before result commit.
- 100 concurrent claim/replay attempts; stale fence writes and duplicate outbox delivery.
- Stop vs claim race, partition/watchdog expiry, restart with active stop latch, explicit clear without resume.
- Event revocation, slow client, expired cursor, wrong org and queue tampering.

Use deterministic/fake services first. Any live inference, public deployment, publication or payment action needs existing user authorization for that action; local tests must not silently use real keys. Record exact commands, versions, fixture seeds and exit results. An unavailable dependency is unverified/blocked, not passed.

## Security considerations

- Worker must validate canonical organization/grant; queue payload is not authorization.
- LLM output never directly executes a tool or changes quotas/roles.
- External action uncertainty remains visible; exactly-once physical effects are not claimed.

## Acceptance criteria

- [ ] Deterministic multi-task mission completes through API/CLI and emits authorized events.
- [ ] Restart/Redis loss recovers durable state and stale workers cannot commit results.
- [ ] Pause/cancel/stop meet defined semantics, with stop timing measured under partition.
- [ ] Required tests pass, relevant documentation is updated, and no unreviewed safety regression remains.
- [ ] Every completed task points to concrete evidence; deferred checks are explicitly listed with impact.

## Demonstration and independent verification

Run a fake multi-agent DAG, crash a worker mid-task, show safe reconciliation, then latch Stop All and prove no automatic resume after restart.

## Documentation and deliverables

Runtime state machines; schema/outbox; worker protocol; SDK/CLI; fault harness; chapter review.

Update the OpenAPI/SDK or configuration reference when changed, add migrations/compatibility notes, and capture limitations. Use a dedicated chapter review document based on [the review template](../templates/chapter-review.md). Do not edit the original source blueprint.

## Review checkpoint and next handoff

Fill the chapter review with implementation summary, task/requirement mapping, checks, security evidence, benchmark results where relevant, known issues and next steps. Update [status](../delivery/status.md), [backlog](../delivery/backlog.md) and [decisions](../delivery/risks-and-decisions.md) together. A chapter is accepted only when its acceptance evidence is reviewed.

Complete the authorized scope before asking for the next chapter. Default chapter-by-chapter authorization follows the blueprint; an explicit user instruction authorizing multiple chapters overrides that default. Use [the handoff template](../templates/agent-handoff.md) so the next session can resume without reconstructing context.
