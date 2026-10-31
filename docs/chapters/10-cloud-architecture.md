# Chapter 10 — Cloud architecture — design only

**Status:** not started. **Specification:** ready for engineering review. **Implementation evidence:** none.

**Milestone:** M5. **Requirements:** PR-001, PR-019–020.

## Objective

Design a separate managed BYOK service with tenant isolation, operational metering and optional hybrid private runners while preserving Core independence.

## Dependencies and entry gate

Chapter 09 accepted before committing to Cloud operations. No Cloud implementation is required or authorized by Core delivery.

Before work: inspect Git status, read AGENTS.md and delivery status, confirm the authorized chapter scope, and inspect the previous review evidence. Do not assume a dependency is complete merely because its specification exists.

## Scope and implementation approach

Architecture, tenant lifecycle, trust/isolation models, metering/billing boundaries, hybrid protocol, operational cost model and commercial decision gates. Produce documents only.

A separate craftlayer-cloud repository/deployment consumes versioned public Core packages/APIs. Cloud identity/provisioning/billing are service responsibilities. Core cannot import private Cloud modules or require entitlements.

Architecture references: [system-design](../architecture/system-design.md), [cloud-boundaries](../architecture/cloud-boundaries.md), [security-and-access](../architecture/security-and-access.md).

## Ordered engineering tasks

Each task is initially unchecked. Dependencies below describe the default conservative order; record an explicit justified dependency change before reordering. Task sizes are relative engineering complexity (M/L), not delivery dates.

### [ ] CL-10-01 — Service and package boundary design

**Depends on:** Chapter 09 gate. **Size:** M. **Status:** not started.

**Implementation:** Document public Core interfaces, version/release consumption, separate Cloud ownership/deployments and no hidden control dependencies. Specify tenant/org mapping and privileged control paths.

**Required evidence:** Dependency diagram and package audit prove self-hosted boot/upgrade/export stay independent.

### [ ] CL-10-02 — Tenant provisioning and identity design

**Depends on:** CL-10-01. **Size:** L. **Status:** not started.

**Implementation:** Define tenant/workspace lifecycle, optional OIDC/social login, role mapping, invitation and support access controls. Choose application/data-plane isolation tier and justify threat boundaries.

**Required evidence:** Threat model covers cross-tenant API/events/storage/queues and privileged support actions.

### [ ] CL-10-03 — BYOK and hosted execution isolation

**Depends on:** CL-10-02. **Size:** L. **Status:** not started.

**Implementation:** Specify per-tenant key separation/rotation, credential access, dedicated/sandboxed workers and egress. Avoid shared-process hostile code and token resale in initial business model.

**Required evidence:** Credential compromise and runner escape scenarios have bounded blast radius and testable controls.

### [ ] CL-10-04 — Metering and subscription design

**Depends on:** CL-10-03. **Size:** L. **Status:** not started.

**Implementation:** Model hosting plans, resource quotas, immutable usage events, subscription lifecycle and signed idempotent webhooks. Separate infrastructure usage from provider invoice/estimated token usage.

**Required evidence:** Reconciliation/duplicate/out-of-order/refund/failure scenarios are documented without invented prices.

### [ ] CL-10-05 — Hybrid outbound runner protocol

**Depends on:** CL-10-04. **Size:** L. **Status:** not started.

**Implementation:** Design enrollment, tenant binding, mutual authentication, capability grants, revocation, replay protection and reconnect/stop leases. Runners do not expose inbound admin ports.

**Required evidence:** Partition/revoke/re-enroll threat walkthrough preserves local policy ceilings and Stop All.

### [ ] CL-10-06 — Operations, portability and commercial review

**Depends on:** CL-10-05. **Size:** L. **Status:** not started.

**Implementation:** Plan backups/restore, regional privacy choices, export/delete, abuse/support, incidents, capacity/cost measurement and provider terms review. Do not assume legal/tax compliance or resale rights.

**Required evidence:** Cost model uses measured Core data with explicit unknowns; service exit does not break standalone Core.

### [ ] CL-10-07 — Architecture approval package

**Depends on:** CL-10-06. **Size:** M. **Status:** not started.

**Implementation:** Prepare Cloud ADRs, threat model, API/protocol proposals, cost/terms decision register and go/no-go criteria for a separate build. Record reviewer decisions.

**Required evidence:** All design gates reviewed; no Cloud code or required entitlement enters Core.

## Test plan

- Design walkthrough: guessed tenant ID, malicious worker, stolen key, support role abuse.
- Billing replay/out-of-order event and cancellation during active work scenarios.
- Hybrid partition/expired lease/revoked runner and attempted policy widening.
- Core without Cloud DNS/account and tenant export/exit walkthrough.

Use deterministic/fake services first. Any live inference, public deployment, publication or payment action needs existing user authorization for that action; local tests must not silently use real keys. Record exact commands, versions, fixture seeds and exit results. An unavailable dependency is unverified/blocked, not passed.

## Security considerations

- No revenue assumptions justify weakening tenant isolation or key protection.
- BYOK hosting first; optional platform-billed inference is a separately reviewed future feature.
- No live payments, public provisioning or Cloud deployment in this chapter.

## Acceptance criteria

- [ ] Reviewed design specifies tenant/BYOK/billing/worker/hybrid trust boundaries.
- [ ] Core remains fully useful and independently deployable.
- [ ] Open commercial/security questions and separate implementation authorization are explicit.
- [ ] Required tests pass, relevant documentation is updated, and no unreviewed safety regression remains.
- [ ] Every completed task points to concrete evidence; deferred checks are explicitly listed with impact.

## Demonstration and independent verification

Architecture tabletop using failure scenarios and a dependency graph; no implementation demo is required.

## Documentation and deliverables

Separate-service ADR package; threat model; billing/usage contracts; hybrid protocol; cost model; reviewed go/no-go.

Update the OpenAPI/SDK or configuration reference when changed, add migrations/compatibility notes, and capture limitations. Use a dedicated chapter review document based on [the review template](../templates/chapter-review.md). Do not edit the original source blueprint.

## Review checkpoint and next handoff

Fill the chapter review with implementation summary, task/requirement mapping, checks, security evidence, benchmark results where relevant, known issues and next steps. Update [status](../delivery/status.md), [backlog](../delivery/backlog.md) and [decisions](../delivery/risks-and-decisions.md) together. A chapter is accepted only when its acceptance evidence is reviewed.

Complete the authorized scope before asking for the next chapter. Default chapter-by-chapter authorization follows the blueprint; an explicit user instruction authorizing multiple chapters overrides that default. Use [the handoff template](../templates/agent-handoff.md) so the next session can resume without reconstructing context.
