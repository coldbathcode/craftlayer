# Chapter 01 — Identity and RBAC

**Status:** in progress; authorized by the user after Chapter 00. **Implementation evidence:** [build log](../delivery/build-log.md).

**Milestone:** M0. **Requirements:** PR-002–004, PR-021; NFR-08.

## Objective

Make local accounts, organization membership and resource-scoped permissions the security boundary for every later feature.

## Dependencies and entry gate

Chapter 00 accepted. Database/RLS/context conventions and private transport are available.

Before work: inspect Git status, read AGENTS.md and delivery status, confirm the authorized chapter scope, and inspect the previous review evidence. Do not assume a dependency is complete merely because its specification exists.

## Scope and implementation approach

Owner bootstrap, local login, sessions, invitations, reset/recovery, membership/roles, project/world grants, child onboarding and redacted audit. Defer OIDC/social login.

Use global identity tables through narrow auth repositories and tenant-scoped application repositories. Instance privilege is distinct from org membership. Authorization services return explicit decisions and worker execution grants, not a generic admin boolean.

Architecture references: [security-and-access](../architecture/security-and-access.md), [data-model](../architecture/data-model.md), [api-and-events](../architecture/api-and-events.md).

## Ordered engineering tasks

Each task is initially unchecked. Dependencies below describe the default conservative order; record an explicit justified dependency change before reordering. Task sizes are relative engineering complexity (M/L), not delivery dates.

### [x] CL-01-01 — Identity schema and role seeds

**Depends on:** Chapter 00 gate. **Size:** L. **Status:** verified; see build log.

**Implementation:** Implement users, owners, memberships, roles/permissions, grants, invitations, sessions and audit migrations. Seed built-in roles idempotently and enforce composite tenant references.

**Required evidence:** Role fixtures and migration upgrades preserve deny-by-default permissions and prevent cross-org assignments.

### [ ] CL-01-02 — Secure bootstrap and password sessions

**Depends on:** CL-01-01. **Size:** L. **Status:** not started.

**Implementation:** Build single-use local owner setup, vetted password hashing, login/logout, session rotation/expiry and CSRF/Origin protection. Measure hashing settings and throttle abuse.

**Required evidence:** Bootstrap race creates one owner; session fixation, invalid CSRF, expired and revoked tokens fail.

### [ ] CL-01-03 — Authorization and resource scopes

**Depends on:** CL-01-02. **Size:** L. **Status:** not started.

**Implementation:** Implement permission catalog, membership-derived context, project/world/ownership checks and account restrictions. Require authorization at service boundaries and current versions for later worker grants.

**Required evidence:** Table-driven tests cover every role/action/scope combination, including combined child roles.

### [ ] CL-01-04 — Invitations and lifecycle management

**Depends on:** CL-01-03. **Size:** L. **Status:** not started.

**Implementation:** Add adult-issued expiring single-use invitations, org-scoped membership disable, role changes and session revocation; installation-owner authority is required for global identity disable. Enforce last-owner recovery rules and invalidate cached authorization.

**Required evidence:** Invite reuse, privilege escalation and disabled-user requests/queued grants are denied.

### [ ] CL-01-05 — Password recovery and child accounts

**Depends on:** CL-01-04. **Size:** M. **Status:** not started.

**Implementation:** Implement optional configured email reset and offline owner recovery with no token leakage. Adult creates child identity without requiring child email; restrict login/onboarding and assignments.

**Required evidence:** Expired/replayed reset fails, successful reset revokes sessions, child cannot self-upgrade or invoke owner tools.

### [ ] CL-01-06 — Identity API and audit projection

**Depends on:** CL-01-05. **Size:** M. **Status:** not started.

**Implementation:** Expose explicit safe routes with validation, rate limits, redacted responses and transactional audit. Add minimal administrative UI/API fixtures sufficient to operate accounts until Chapter 05.

**Required evidence:** Audit captures successful/denied sensitive operations without secrets; foreign users/counts are not disclosed.

### [ ] CL-01-07 — Isolation and revocation review

**Depends on:** CL-01-06. **Size:** L. **Status:** not started.

**Implementation:** Run full cross-org API/RLS tests, pooled context reuse, role/resource matrix and permission-change concurrency cases. Document recovery and administrator workflow.

**Required evidence:** A revoked session/member loses REST and future execution authority; evidence includes actual runtime DB role.

## Test plan

- Wrong-org IDs in direct routes, lists, filters, invitation roles and project grants.
- Concurrent bootstrap, last owner disable, duplicate invite consume and reset consume.
- Hash/cookie/CSRF/session expiry/revocation and no account enumeration.
- Child account ceilings survive multiple role assignments and guessed administrative endpoints.

Use deterministic/fake services first. Any live inference, public deployment, publication or payment action needs existing user authorization for that action; local tests must not silently use real keys. Record exact commands, versions, fixture seeds and exit results. An unavailable dependency is unverified/blocked, not passed.

## Security considerations

- No global DB bypass connection exposed to request handlers.
- No public child registration or unnecessary child personal data.
- Audit and state changes commit atomically; plaintext secrets/tokens never return after setup.

## Acceptance criteria

- [ ] All role/scope fixtures deny unauthorized operations and permit intended positive journeys.
- [ ] Disabled/revoked principals lose access, and local recovery works without Cloud/email service.
- [ ] Provider credentials remain a restricted future resource; no generic secret GET endpoint exists.
- [ ] Required tests pass, relevant documentation is updated, and no unreviewed safety regression remains.
- [ ] Every completed task points to concrete evidence; deferred checks are explicitly listed with impact.

## Demonstration and independent verification

Bootstrap an owner, create two orgs and a child, demonstrate allowed scoped access, cross-org denial and session revocation.

## Documentation and deliverables

Auth schema/services; permission matrix tests; identity OpenAPI; local bootstrap/reset runbook; chapter review.

Update the OpenAPI/SDK or configuration reference when changed, add migrations/compatibility notes, and capture limitations. Use a dedicated chapter review document based on [the review template](../templates/chapter-review.md). Do not edit the original source blueprint.

## Review checkpoint and next handoff

Fill the chapter review with implementation summary, task/requirement mapping, checks, security evidence, benchmark results where relevant, known issues and next steps. Update [status](../delivery/status.md), [backlog](../delivery/backlog.md) and [decisions](../delivery/risks-and-decisions.md) together. A chapter is accepted only when its acceptance evidence is reviewed.

Complete the authorized scope before asking for the next chapter. Default chapter-by-chapter authorization follows the blueprint; an explicit user instruction authorizing multiple chapters overrides that default. Use [the handoff template](../templates/agent-handoff.md) so the next session can resume without reconstructing context.
