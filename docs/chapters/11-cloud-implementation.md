# Chapter 11 — Optional Cloud implementation

**Status:** not started. **Specification:** ready for engineering review. **Implementation evidence:** none.

**Milestone:** M6. **Requirements:** PR-019–020 plus inherited tenant/credential/runtime safety requirements.

## Objective

Implement the separately authorized managed hosting service without transferring commercial obligations into self-hosted Core.

## Dependencies and entry gate

Chapter 10 reviewed, Core stable/useful, explicit Cloud authorization, separate repository and resolved release/commercial prerequisites.

Before work: inspect Git status, read AGENTS.md and delivery status, confirm the authorized chapter scope, and inspect the previous review evidence. Do not assume a dependency is complete merely because its specification exists.

## Scope and implementation approach

Separate repository: tenant onboarding/identity, provisioning, BYOK isolation, hosted workers, measured hosting subscriptions, operations and optional gated hybrid beta. Token resale remains excluded unless separately approved.

Implement the reviewed Chapter 10 contracts. Use versioned Core artifacts and isolated Cloud lifecycle services; no fork-only features required for basic Core functionality.

Architecture references: [cloud-boundaries](../architecture/cloud-boundaries.md), [security-and-access](../architecture/security-and-access.md).

## Ordered engineering tasks

Each task is initially unchecked. Dependencies below describe the default conservative order; record an explicit justified dependency change before reordering. Task sizes are relative engineering complexity (M/L), not delivery dates.

### [ ] CL-11-01 — Separate Cloud foundation

**Depends on:** Chapter 10 gate. **Size:** L. **Status:** not started.

**Implementation:** Create authorized separate repo, CI, private environments, infrastructure plans and versioned Core dependency. Establish tenant-scoped identity and operational secrets.

**Required evidence:** Core builds/boots unchanged; Cloud dependency graph has one-way public dependency on Core.

### [ ] CL-11-02 — Tenant onboarding and provisioning

**Depends on:** CL-11-01. **Size:** L. **Status:** not started.

**Implementation:** Implement idempotent tenant lifecycle, org mapping, roles, resource quotas and rollback/reconciliation for partial provisioning. Keep support access explicit/time-bounded/audited.

**Required evidence:** Duplicate/failed onboarding cannot leak or orphan active tenant resources; offboarding revokes authority.

### [ ] CL-11-03 — BYOK credentials and hosted workers

**Depends on:** CL-11-02. **Size:** L. **Status:** not started.

**Implementation:** Implement tenant key separation, rotation and least-privilege access; provision isolated workers/runners with resource/egress limits and inherited stop/lease controls.

**Required evidence:** Cross-tenant secret/task/log/storage access denies; hostile job cannot read peer/host/control-plane secrets.

### [ ] CL-11-04 — Infrastructure metering and subscriptions

**Depends on:** CL-11-03. **Size:** L. **Status:** not started.

**Implementation:** Implement immutable metering, test-mode subscription integration, authenticated/idempotent webhooks and reconciliation. Set measured hosting prices only after authorized business review.

**Required evidence:** Duplicate/out-of-order webhooks, failed payment, cancellation and reconciliation tests pass without real charges.

### [ ] CL-11-05 — Managed operations and support

**Depends on:** CL-11-04. **Size:** L. **Status:** not started.

**Implementation:** Implement tenant backup/restore/export/delete, monitoring, incident/support access, audit retention and upgrade rollouts. Test restore scoped to one tenant.

**Required evidence:** Recovery/export/offboarding protect other tenants and produce auditable, bounded support actions.

### [ ] CL-11-06 — Optional hybrid beta

**Depends on:** CL-11-05. **Size:** L. **Status:** not started.

**Implementation:** Only if separately included in authorization, implement enrollment/mutual auth, outbound channel, tenant/capability binding, revocation, replay protection and lease/watchdog. Otherwise record feature as deferred.

**Required evidence:** Runner partition/revocation stops new work; local policy cannot be widened by Cloud; Core works after disconnect.

### [ ] CL-11-07 — Private beta and launch gate

**Depends on:** CL-11-06. **Size:** L. **Status:** not started.

**Implementation:** Run tenancy/load/billing/security/restore tests, rehearse incidents and calculate margins from measurements. Prepare concrete release review before any authorized public launch.

**Required evidence:** Beta has reviewed isolation/operations evidence, measured costs and unresolved launch blockers documented.

## Test plan

- Cross-tenant guessed IDs, queues, event replay, artifact URLs, credentials and support actions.
- Partial provisioning, payment event duplication/order, active-work cancellation and quota exhaustion.
- Hostile code isolation, tenant restore/export/delete and worker revocation.
- Hybrid optional tests if included; Core completely disconnected from Cloud.

Use deterministic/fake services first. Any live inference, public deployment, publication or payment action needs existing user authorization for that action; local tests must not silently use real keys. Record exact commands, versions, fixture seeds and exit results. An unavailable dependency is unverified/blocked, not passed.

## Security considerations

- This chapter is not permission to create paid infrastructure, charge cards or publish publicly.
- Separate Cloud authorization must specify service/account/environment scope.
- No platform-billed inference before provider-specific commercial/operational review.

## Acceptance criteria

- [ ] Authorized separate Cloud repo supports tenant onboarding/BYOK/hosting metering safely.
- [ ] All inherited tenant/stop/usage controls and Cloud-specific tests pass.
- [ ] Core independence is reverified; launch/payment actions have their own explicit authorization.
- [ ] Required tests pass, relevant documentation is updated, and no unreviewed safety regression remains.
- [ ] Every completed task points to concrete evidence; deferred checks are explicitly listed with impact.

## Demonstration and independent verification

Private test-mode tenant onboarding, isolated mission, usage/subscription replay and tenant restore; no real charge/public launch required.

## Documentation and deliverables

In separate Cloud repo: implementation, infra, security/billing/restore tests, runbooks and reviewed beta/launch package.

Update the OpenAPI/SDK or configuration reference when changed, add migrations/compatibility notes, and capture limitations. Use a dedicated chapter review document based on [the review template](../templates/chapter-review.md). Do not edit the original source blueprint.

## Review checkpoint and next handoff

Fill the chapter review with implementation summary, task/requirement mapping, checks, security evidence, benchmark results where relevant, known issues and next steps. Update [status](../delivery/status.md), [backlog](../delivery/backlog.md) and [decisions](../delivery/risks-and-decisions.md) together. A chapter is accepted only when its acceptance evidence is reviewed.

Complete the authorized scope before asking for the next chapter. Default chapter-by-chapter authorization follows the blueprint; an explicit user instruction authorizing multiple chapters overrides that default. Use [the handoff template](../templates/agent-handoff.md) so the next session can resume without reconstructing context.
