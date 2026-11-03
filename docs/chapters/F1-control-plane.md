# F1 — Read-only control plane and parent dashboard

**Status:** F1 locally authorized by the user’s “go to the next steps” after F0; CL-F1-01–03 locally verified; local review prepared, owner advancement pending. **Milestone:** F1. **Requirements:** PR-024–025, PR-028, PR-035. No production evidence exists.

## Objective

Earliest usable observation dashboard: adult logs in and sees safely adopted server/status/players/audit without bots/models. This is not the family-ready access/backup release.

## Dependencies and entry gate

Explicit F1 authorization; F0 local review and Chapters 00–01. Live adoption additionally requires approved read-only preflight. Chapter 03 and LLMs are not prerequisites.

Read AGENTS.md, current status, [track](../delivery/minecraft-track.md), [management architecture](../architecture/minecraft-management.md), security and preservation references. Inspect Git status and preserve unrelated work. Each phase is a separately authorized chapter boundary.

## Ordered engineering tasks

### [x] CL-F1-01 — Server and operation contracts, scope and permissions

**Depends on:** F0 local gate. **Status:** verified locally; ADR 0017 and build log. **Size:** L.

**Implementation:** Add strict server/status/observation/operation contracts, additive tenant-aware server/operation/outbox schema and tested canonical server-scoped permission grants. Preserve identity child ceilings and existing routes. Establish durable operation IDs/idempotency and timestamped observations independently of mission runtime.

**Required evidence:** MC-01/06: actual restricted-role migrations and A/B server/project scope, child/viewer denial, current membership/revocation, same-key replay/conflict, atomic audit/outbox. No external mutable adapter capability.

### [x] CL-F1-02 — In-place adoption and private observation adapter

**Depends on:** CL-F1-01. **Status:** locally verified; observation runbook and build log. **Size:** L.

**Implementation:** Implement adopt plan/register and bounded read-only status/player observations through capability-based mock/private RCON or query adapter. Credentials stay isolated, no arbitrary verbs, Docker control or game/world mounts in apps. Unsupported/stale/offline states explicit; extend typed REST/SDK and scoped projections.

**Required evidence:** MC-02/05: existing container/mount/config/state stable, offline server never started, redacted output, cross-tenant observations denied, no RCON/host commands injectable. Captured synthetic inventory is sufficient for local work.

### [x] CL-F1-03 — Parent dashboard and protected entry review

**Depends on:** CL-F1-02. **Status:** verified locally; remote entry remains blocked pending separate qualification. **Size:** L.

**Implementation:** Extend account shell with mobile server list/detail, connection instructions, online players where supported, audit and security/backup gaps. Adopt Existing is distinct from future Create Server. Qualify TLS/private access/MFA for remotely accessible privileged paths; no remote exposure by default.

**Required evidence:** MC-01/05/12 browser positive/denied journeys, keyboard/mobile/error/stale state and provider-absent operation. Observation preview only; backup/access/lifecycle controls unavailable until their gates.

## Test plan

MC-01/02/05/06/12 portions for adoption/observations; database and browser suites with fake adapters. Private remote entry requires separate configuration proof. See [acceptance matrix](../testing/minecraft-management.md) for exact scenarios and required real/manual evidence. Add test commands only with implementation; do not claim existing commands exercise new features.

## Security considerations

[Threat model](../security/THREAT_MODEL.md) and [deployment checklist](../security/DEPLOYMENT_CHECKLIST.md) apply. No arbitrary RCON/shell/Docker proxy, public management ports, child administration or model-dependent authorization. Secrets stay outside app projections, logs, queues and Git. Preserve worlds, manually stopped state and unrelated workloads.

## Acceptance criteria

- [x] All phase task evidence and applicable MC gates pass in the claimed environment; unknown/manual gaps explicitly block readiness where critical.
- [x] Earliest usable observation dashboard: adult logs in and sees safely adopted server/status/players/audit without bots/models. This is not the family-ready access/backup release.
- [x] Authorization, tenant/child denial, redaction, uncertain effects and preservation reviewed; no production actions inferred from local checks.
- [x] Rollback/backup procedures rehearsed on disposable resources with exact evidence and current risk/ADR/status records.

## Rollback and backup

Follow [preservation procedures](../operations/minecraft-preservation.md). F0 inventory has no live writes; F1 unbinds only registration. Access changes use versioned compensation, backup failure preserves known-good copies, provisioning rollback removes only ownership-proven new runtime resources while retaining worlds/backups. Live writes require verified recovery, exact rollback and operator approval. Never overwrite/delete a real world to test a plan.

## Documentation and deliverables

Contracts/schema/API/SDK and operator instructions for implemented capabilities; exact checks/artifact/version evidence; [chapter review](../templates/chapter-review.md), risk register, status/build log and [handoff](../templates/agent-handoff.md). Every coherent build step commits only task changes and pushes origin main under AGENTS.md.

Local evidence: [F1 review](../reviews/F1-control-plane.md), [handoff](../delivery/handoffs/F1-control-plane.md) and [management runbook](../development/minecraft-management.md). Checkboxes cover local observation scope only. No actual container/world adoption, game restore or private remote-entry gate is claimed.

## Review checkpoint and next handoff

Review applicable security/recovery and acceptance evidence before authorizing the next phase. Documentation or fake-only proof is not production readiness. Report exact next task and outstanding production/manual gates; never silently cross a phase boundary. Preserve completed original chapters and source inputs.

Local follow-up REV-04: the Observe notice now derives from current authorized readback, reports unchanged source time and actual freshness/timestamp, and never advances a static capture. Production-image browser regression covers unchanged stale and newly captured fresh observations. This does not close remote/private-entry/MFA or game/family release gates; see the current build log.

Local REV-03/A follow-up changes the 10,000 environment-operation ceiling from lifetime to a rolling 24-hour admission budget, retaining minute limits, all history and current authorization/fences/replay. No source query is repeated by replay or performed after budget refusal. Audited retention/archival and enrollment limits remain separate open work (ADR 0028).

REV-09 adds mandatory workflow execution of the existing disposable dashboard browser journey on main pushes and pull requests. Explicit Playwright suite selection and a fail-fast management fixture guard prevent silent skipped coverage. This does not change branch-protection rules or certify the actual Minecraft deployment; current hosted/local evidence is recorded in build log.
