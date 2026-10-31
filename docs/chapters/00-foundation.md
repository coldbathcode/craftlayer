# Chapter 00 — Foundation

**Status:** in progress. **Implementation evidence:** [build log](../delivery/build-log.md).

**Milestone:** M0. **Requirements:** PR-001, PR-003, PR-017; NFR-09.

## Objective

Create a reproducible TypeScript engineering environment and private local stack with the structural boundaries needed for later security and runtime work.

## Dependencies and entry gate

None. Read the blueprint and architecture decisions before scaffolding.

Before work: inspect Git status, read AGENTS.md and delivery status, confirm the authorized chapter scope, and inspect the previous review evidence. Do not assume a dependency is complete merely because its specification exists.

## Scope and implementation approach

Monorepo, strict tooling, API/web/worker health shells, database migration infrastructure, minimal organization/project context primitives, CI and Compose. Do not implement complete auth, provider calls, mission execution or Cloud.

Use the package boundaries in system-design.md. Start with core/contracts/config/db plus API/web/worker/CLI composition roots as needed. Tenant context types and non-bypass runtime DB role exist before feature routes. Health shells are not authorization bypasses.

Architecture references: [system-design](../architecture/system-design.md), [data-model](../architecture/data-model.md), [security-and-access](../architecture/security-and-access.md).

## Ordered engineering tasks

Each task is initially unchecked. Dependencies below describe the default conservative order; record an explicit justified dependency change before reordering. Task sizes are relative engineering complexity (M/L), not delivery dates.

### [x] CL-00-01 — Compatibility and toolchain decision

**Depends on:** None. **Size:** M. **Status:** verified; see build log.

**Implementation:** Research supported runtime/library versions, Java/Mineflayer constraints and image architectures. Pin Node/pnpm, lockfile format, image tags/digests and dependency policy in an ADR; verify on the available host.

**Required evidence:** A recorded compatibility matrix explains each pinned major and any unsupported host architecture.

### [ ] CL-00-02 — Workspace and dependency boundaries

**Depends on:** CL-00-01. **Size:** M. **Status:** not started.

**Implementation:** Create pnpm workspace, strict TS configs, lint/format/build conventions and scripts. Establish pure contracts/core/config and dependency rules; no placeholders masquerading as implemented features.

**Required evidence:** A deliberate forbidden server import into web is rejected; a clean install uses the lockfile.

### [ ] CL-00-03 — Database and organization foundation

**Depends on:** CL-00-02. **Size:** L. **Status:** not started.

**Implementation:** Add Drizzle migration runner, separate migration/runtime roles, organization/project schema seeds and transaction-scoped context. Implement minimal tenant RLS fixtures and composite FK conventions without completing identity.

**Required evidence:** Fresh migration passes; missing/wrong context and cross-org parent references deny using the actual runtime role.

### [ ] CL-00-04 — Application shells and validated configuration

**Depends on:** CL-00-03. **Size:** M. **Status:** not started.

**Implementation:** Add Fastify app factory, Next shell, worker startup/shutdown and CLI help/config validation. Define secret/server/public config separation, redacted logs, liveness/readiness and correlated errors.

**Required evidence:** Invalid/missing required config fails clearly; process shutdown is bounded; health output contains no credentials.

### [ ] CL-00-05 — Private Compose development stack

**Depends on:** CL-00-04. **Size:** L. **Status:** not started.

**Implementation:** Create Dockerfiles/Compose with PostgreSQL, Redis, API, web and worker, named volumes, loopback exposure, health checks, resource/log limits and optional profiles. Keep Minecraft/Ollama disabled until their chapters configure them.

**Required evidence:** Compose config validates; services build and reach documented readiness without any Cloud/provider account.

### [ ] CL-00-06 — Automated checks and CI

**Depends on:** CL-00-05. **Size:** L. **Status:** not started.

**Implementation:** Add meaningful unit/schema/config tests, real DB isolation smoke, dependency boundary checks, docs links and a CI pipeline. Establish the documented command contract and controlled test networking.

**Required evidence:** Clean clone runs lint, typecheck, unit/integration checks and build; CI uses no provider secrets.

### [ ] CL-00-07 — Developer quickstart and foundation review

**Depends on:** CL-00-06. **Size:** M. **Status:** not started.

**Implementation:** Document prerequisites, exact scripts, local URLs, first migration, reset/cleanup safety, supported host limitations and measured resource footprint. Prepare the chapter review and record remaining decisions.

**Required evidence:** A fresh checkout follows the quickstart without unpublished steps; all required command results are recorded.

## Test plan

- Empty database and repeat migration; migration role can DDL while runtime role cannot.
- A/B organizations on the same pooled connection do not leak context after commit/rollback.
- Missing env, invalid URL, unknown config key, log-secret canary and graceful SIGTERM.
- Private default port bindings and no Cloud-related startup requests.

Use deterministic/fake services first. Any live inference, public deployment, publication or payment action needs existing user authorization for that action; local tests must not silently use real keys. Record exact commands, versions, fixture seeds and exit results. An unavailable dependency is unverified/blocked, not passed.

## Security considerations

- No hardcoded credentials or published DB/Redis ports.
- Initial setup is not public signup; full owner bootstrap waits for Chapter 01.
- Dependency/version research does not authorize purchasing services or using live paid APIs.

## Acceptance criteria

- [ ] Clean checkout installs, validates, builds and runs the documented local shells.
- [ ] Compose syntax and actual readiness are both checked; syntax alone is not runtime evidence.
- [ ] Tenant foundation tests run with least-privileged roles and CI checks pass.
- [ ] Required tests pass, relevant documentation is updated, and no unreviewed safety regression remains.
- [ ] Every completed task points to concrete evidence; deferred checks are explicitly listed with impact.

## Demonstration and independent verification

Show a new checkout starting privately, API health/readiness, dashboard shell and worker startup. Demonstrate denied cross-org DB access. This is a foundation demo, not a functional mission.

## Documentation and deliverables

Pinned toolchain ADR; root scripts; CI; Compose files; .env.example; developer quickstart; chapter review evidence.

Update the OpenAPI/SDK or configuration reference when changed, add migrations/compatibility notes, and capture limitations. Use a dedicated chapter review document based on [the review template](../templates/chapter-review.md). Do not edit the original source blueprint.

## Review checkpoint and next handoff

Fill the chapter review with implementation summary, task/requirement mapping, checks, security evidence, benchmark results where relevant, known issues and next steps. Update [status](../delivery/status.md), [backlog](../delivery/backlog.md) and [decisions](../delivery/risks-and-decisions.md) together. A chapter is accepted only when its acceptance evidence is reviewed.

Complete the authorized scope before asking for the next chapter. Default chapter-by-chapter authorization follows the blueprint; an explicit user instruction authorizing multiple chapters overrides that default. Use [the handoff template](../templates/agent-handoff.md) so the next session can resume without reconstructing context.
