# Chapter 09 — Self-hosted release

**Status:** not started. **Specification:** ready for engineering review. **Implementation evidence:** none.

**Milestone:** M4. **Requirements:** PR-001, PR-017–018, PR-021–022; NFR-01–10.

## Objective

Ship a documented, measured and recoverable self-hosted Core release that remains useful without CraftLayer Cloud.

## Dependencies and entry gate

Chapters 00–08 accepted. All claimed Core features have implementation and chapter evidence.

Before work: inspect Git status, read AGENTS.md and delivery status, confirm the authorized chapter scope, and inspect the previous review evidence. Do not assume a dependency is complete merely because its specification exists.

## Scope and implementation approach

Fresh setup, release images, multi-architecture verification, upgrade/migration, backup/restore, monitoring/runbooks, CLI completion, contributor/security/license policies and final security review.

Release artifacts are pinned/versioned and schema/protocol compatibility is explicit. Optional profiles remain optional; local identity and settings have no Cloud bootstrap dependency.

Architecture references: [system-design](../architecture/system-design.md), [security-and-access](../architecture/security-and-access.md).

## Ordered engineering tasks

Each task is initially unchecked. Dependencies below describe the default conservative order; record an explicit justified dependency change before reordering. Task sizes are relative engineering complexity (M/L), not delivery dates.

### [ ] CL-09-01 — Release inventory and compatibility

**Depends on:** Chapter 08 gate. **Size:** M. **Status:** not started.

**Implementation:** Freeze feature/API/adapter matrix, supported host architectures and versioned image/schema compatibility. Resolve license choice and dependencies; select real maintainer/disclosure contacts.

**Required evidence:** No unimplemented feature is marketed as complete; license/SBOM and compatibility review recorded.

### [ ] CL-09-02 — Production Compose and setup experience

**Depends on:** CL-09-01. **Size:** L. **Status:** not started.

**Implementation:** Harden profiles/secrets/TLS/private access/resource/log settings, implement setup/config validation and document fresh Ubuntu/macOS steps. Complete CLI parity and owner-only tools.

**Required evidence:** Fresh host deployment works without unpublished commands, Cloud account, required telemetry or provider subscription.

### [ ] CL-09-03 — Backup, restore and key recovery

**Depends on:** CL-09-02. **Size:** L. **Status:** not started.

**Implementation:** Implement coordinated DB/world/artifact/config backup, separate key protection, encryption/checksums/retention and clean-host restore. Keep restored missions stopped until reconciliation.

**Required evidence:** Nontrivial dataset restored; lost key/corrupt archive/low disk cases fail safely; actual RPO/RTO measured.

### [ ] CL-09-04 — Upgrade and interrupted-migration drill

**Depends on:** CL-09-03. **Size:** L. **Status:** not started.

**Implementation:** Build versioned upgrade checks, maintenance/drain, expand-contract migrations and documented forward repair/restore rollback paths. Validate mixed worker/API protocol refusal.

**Required evidence:** Previous release fixture upgrades; interrupted migration and incompatible old worker do not corrupt/execute work.

### [ ] CL-09-05 — Observability and resource qualification

**Depends on:** CL-09-04. **Size:** L. **Status:** not started.

**Implementation:** Ship local logs/metrics/health/runbooks, tune retention and profile CPU/RAM/storage with/without inference. Run API/event/stop/accessibility/soak benchmarks.

**Required evidence:** NFR results identify host/config/versions and limitations; alerts surface unreachable stop and uncertain usage.

### [ ] CL-09-06 — Security and supply-chain release gate

**Depends on:** CL-09-05. **Size:** L. **Status:** not started.

**Implementation:** Run full tenant/child/secret/sandbox/provider/stop suite, dependency/image vulnerability review and no-Cloud egress test. Add contribution, code of conduct, security and release policies with real metadata.

**Required evidence:** Critical exploitable defects resolved; remaining documented risks accepted by owner; no secrets in images/artifacts.

### [ ] CL-09-07 — Signed/versioned release rehearsal

**Depends on:** CL-09-06. **Size:** L. **Status:** not started.

**Implementation:** Build reproducible release images for tested architectures, attach checksums/SBOM/provenance as supported, rehearse release notes and migration guide. Public publishing needs explicit user authorization.

**Required evidence:** Clean operator follows install/demo/stop/backup/restore/upgrade instructions; reviewed release candidate is ready to publish.

## Test plan

- Fresh Ubuntu and macOS/Docker Desktop recipes; only claim architectures actually tested.
- Restore full world/DB/artifacts and separately protected keys on clean stack.
- Upgrade from prior fixture, interrupted migration and mixed protocols.
- Full safety suite, external Cloud domains denied, resource soak and release image scan.

Use deterministic/fake services first. Any live inference, public deployment, publication or payment action needs existing user authorization for that action; local tests must not silently use real keys. Record exact commands, versions, fixture seeds and exit results. An unavailable dependency is unverified/blocked, not passed.

## Security considerations

- No automatic public port exposure, telemetry, license-server dependency or cloud enrollment.
- Private recovery is not an unauthenticated HTTP endpoint.
- Publication is a separate action and all release metadata must be real.

## Acceptance criteria

- [ ] Core install and full advertised examples work independently of Cloud.
- [ ] Backup/restore/upgrade and NFR evidence are attached with known limitations.
- [ ] Security/license/release gates are reviewed; publication only if explicitly authorized.
- [ ] Required tests pass, relevant documentation is updated, and no unreviewed safety regression remains.
- [ ] Every completed task points to concrete evidence; deferred checks are explicitly listed with impact.

## Demonstration and independent verification

On a clean private host install Core, run child Minecraft/coding/research examples, stop, back up, restore and verify Cloud-disconnected operation.

## Documentation and deliverables

Versioned operator docs/runbooks; release manifests/images; backup/upgrade tools; security/license/contribution policies; release review.

Update the OpenAPI/SDK or configuration reference when changed, add migrations/compatibility notes, and capture limitations. Use a dedicated chapter review document based on [the review template](../templates/chapter-review.md). Do not edit the original source blueprint.

## Review checkpoint and next handoff

Fill the chapter review with implementation summary, task/requirement mapping, checks, security evidence, benchmark results where relevant, known issues and next steps. Update [status](../delivery/status.md), [backlog](../delivery/backlog.md) and [decisions](../delivery/risks-and-decisions.md) together. A chapter is accepted only when its acceptance evidence is reviewed.

Complete the authorized scope before asking for the next chapter. Default chapter-by-chapter authorization follows the blueprint; an explicit user instruction authorizing multiple chapters overrides that default. Use [the handoff template](../templates/agent-handoff.md) so the next session can resume without reconstructing context.
