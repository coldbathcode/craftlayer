# Chapter 06 — Cooperative armies

**Status:** not started. **Specification:** ready for engineering review. **Implementation evidence:** none.

**Milestone:** M2. **Requirements:** PR-010, PR-012–013; NFR-03, NFR-06, NFR-10.

## Objective

Make two to three bots cooperate to finish and independently verify a small build in a reproducible private world.

## Dependencies and entry gate

Chapters 00–05 accepted. Safe Minecraft primitives, scheduler, child presets and event UI are operational.

Before work: inspect Git status, read AGENTS.md and delivery status, confirm the authorized chapter scope, and inspect the previous review evidence. Do not assume a dependency is complete merely because its specification exists.

## Scope and implementation approach

Role templates, bounded shared blackboard, material bill, reservations, shared-chest transfer, deterministic blueprint build and cooperative failure recovery. Larger village/survival missions remain incremental extensions.

Use deterministic decomposition for the initial shelter and optional schema-validated planner proposals. All coordination is tasks/reservations/events; no unlimited agent conversation or commander authority bypass.

Architecture references: [minecraft-cooperation](../architecture/minecraft-cooperation.md), [runtime-and-agents](../architecture/runtime-and-agents.md), [model-routing](../architecture/model-routing.md).

## Ordered engineering tasks

Each task is initially unchecked. Dependencies below describe the default conservative order; record an explicit justified dependency change before reordering. Task sizes are relative engineering complexity (M/L), not delivery dates.

### [ ] CL-06-01 — Blueprint and outcome fixture

**Depends on:** Chapter 05 gate. **Size:** M. **Status:** not started.

**Implementation:** Define rotated/anchored 5×5 shelter blocks, material bill, allowed region, terrain assumptions and independent verifier. Split prepared-world and survival-gathering success criteria.

**Required evidence:** Fixture verifies exact required blocks without trusting bot success messages; missing/wrong blocks fail.

### [ ] CL-06-02 — Role templates and bounded planner

**Depends on:** CL-06-01. **Size:** L. **Status:** not started.

**Implementation:** Create Scout/Miner/Lumberjack/Courier/Builder/Quartermaster/Guard/Commander templates, but activate only roles needed by 2–3 bots. Validate finite plan and account capabilities.

**Required evidence:** Invalid or oversized planner output blocks; commander cannot override stop/budget/permissions.

### [ ] CL-06-03 — Blackboard and resource reservations

**Depends on:** CL-06-02. **Size:** L. **Status:** not started.

**Implementation:** Implement typed sightings/inventory/progress entries with TTL/size caps and world-coordinate/material reservations. Use claim leases/fences for build cells and chest quantities.

**Required evidence:** Competing agents cannot own same cell/quantity; stale claims expire without erasing verified work.

### [ ] CL-06-04 — Cooperative supply and placement

**Depends on:** CL-06-03. **Size:** L. **Status:** not started.

**Implementation:** Assign gather/transport/build DAG, bounded chest handoff, inventory precondition checks and safe placement order. Record transfer/action receipts for reconciliation.

**Required evidence:** Two bots share work/materials and verified target blocks appear; shortage blocks with an actionable reason.

### [ ] CL-06-05 — Failure recovery and safe guards

**Depends on:** CL-06-04. **Size:** L. **Status:** not started.

**Implementation:** Handle stuck path, death, inventory loss, conflicting edits, disconnect and insufficient materials. Restrict guard to allowed hostile mobs and keep player attacks disabled.

**Required evidence:** Injected loss/conflict recovers or blocks safely; no duplicate transfer, forbidden dig or player attack occurs.

### [ ] CL-06-06 — Cooperation benchmarks and child preset

**Depends on:** CL-06-05. **Size:** L. **Status:** not started.

**Implementation:** Run 3 seeded prepared-world builds with 2 bots and one optional 3-bot comparison. Measure completion, stop, CPU/RAM, tool/token usage and update bounded child preset approval.

**Required evidence:** Three consecutive prepared-world runs meet target or an explicit reviewed scope/target change is recorded.

### [ ] CL-06-07 — Vertical-slice review and evidence

**Depends on:** CL-06-06. **Size:** M. **Status:** not started.

**Implementation:** Publish versioned example config, world recipe, resource chart, event trace and verifier results. Document limits of CPU inference, survival gathering and scaling.

**Required evidence:** A fresh operator can reproduce the small-build demo with no Cloud and no paid inference requirement.

## Test plan

- Material shortage, chest contention, simultaneous placement and stale reservation.
- Block already placed, wrong block, foreign world edit and unreachable coordinate.
- One bot dies/disconnects; mission retains verified progress and bounded retries.
- Stop All during transfer/build; 3 repeatable seeded runs and reference host soak.

Use deterministic/fake services first. Any live inference, public deployment, publication or payment action needs existing user authorization for that action; local tests must not silently use real keys. Record exact commands, versions, fixture seeds and exit results. An unavailable dependency is unverified/blocked, not passed.

## Security considerations

- No child arbitrary blueprint uploads or command injection through material names.
- Region/resource constraints apply even to deterministic tools.
- Scaling experiments cannot silently raise budgets, tool caps or host limits.

## Acceptance criteria

- [ ] Two bots complete the independently verified shelter in three seeded prepared-world runs.
- [ ] Dashboard shows cooperation/progress and stop works during real actions.
- [ ] Resource/latency results and survival-mode limitations are documented.
- [ ] Required tests pass, relevant documentation is updated, and no unreviewed safety regression remains.
- [ ] Every completed task points to concrete evidence; deferred checks are explicitly listed with impact.

## Demonstration and independent verification

One bot supplies approved materials while another builds; inject an interruption, recover, verify the shelter and stop all bots.

## Documentation and deliverables

Example army/templates; blueprint/BOM/verifier; reservations; seeded benchmark report; child preset approval evidence.

Update the OpenAPI/SDK or configuration reference when changed, add migrations/compatibility notes, and capture limitations. Use a dedicated chapter review document based on [the review template](../templates/chapter-review.md). Do not edit the original source blueprint.

## Review checkpoint and next handoff

Fill the chapter review with implementation summary, task/requirement mapping, checks, security evidence, benchmark results where relevant, known issues and next steps. Update [status](../delivery/status.md), [backlog](../delivery/backlog.md) and [decisions](../delivery/risks-and-decisions.md) together. A chapter is accepted only when its acceptance evidence is reviewed.

Complete the authorized scope before asking for the next chapter. Default chapter-by-chapter authorization follows the blueprint; an explicit user instruction authorizing multiple chapters overrides that default. Use [the handoff template](../templates/agent-handoff.md) so the next session can resume without reconstructing context.
