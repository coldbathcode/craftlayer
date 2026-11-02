# F3 — Multi-server lifecycle and operations

**Status:** local capability development authorized by the user’s VPS deployment/management request; not started; release dependencies remain. **Milestone:** F3. **Requirements:** PR-025, PR-028–029, PR-032–035. No production evidence exists.

## Objective

Full initial server-management dashboard scope including explicit lifecycle controls and multi-server operations, with auditable verified results and preserved data.

## Dependencies and entry gate

User authorized local F3 capability development alongside F2/F2.5; F2.5 remains its release/deployment gate. Adopted production lifecycle is a separate capability/approval; adoption never grants deletion or recreation.

Read AGENTS.md, current status, [track](../delivery/minecraft-track.md), [management architecture](../architecture/minecraft-management.md), security and preservation references. Inspect Git status and preserve unrelated work. Each phase is a separately authorized chapter boundary.

## Ordered engineering tasks

### [ ] CL-F3-01 — Adopted lifecycle, metrics and bounded logs

**Depends on:** F2.5 gate. **Status:** not started. **Size:** L.

**Implementation:** Add approved start/stop/restart for immutable mapped adopted targets through broker, multi-server status/metrics/player/backup health and redacted bounded logs. Current role/scope/stop/approval checks at every effect; respect manually stopped state.

**Required evidence:** MC-01/05/06/10–12: unauthorized lifecycle zero effects, stale/wrong server denied, actual state/progress, restart ambiguity conservative, no raw chat/secrets, stopped state survives node/API restart.

### [ ] CL-F3-02 — Safe update, retained decommission and parity review

**Depends on:** CL-F3-01. **Status:** not started. **Size:** L.

**Implementation:** Implement compatible staged update with verified backup/original storage and exact approval, unregister/retained decommission, full typed REST/MCP parity, allowlisted world-rule/time/weather and approved moderation controls, and operation/audit views. Permanent world erasure/provider-API purchase remain excluded. Reuse F2 isolated restore gates for any approved restore interface.

**Required evidence:** MC-08/09/11: failed update/restore preserves recoverable original, no image-only world downgrade, delete retains storage/backups, unrelated workloads unchanged; MCP high-risk defaults and independent approvals hold. Complete review before new CL-04 bot work.

## Test plan

Complete adopted lifecycle and update/decommission fault tests on disposable copies; retain all family/provisioning security and recovery regressions. Production trials need exact separate approval. See [acceptance matrix](../testing/minecraft-management.md) for exact scenarios and required real/manual evidence. Add test commands only with implementation; do not claim existing commands exercise new features.

## Security considerations

[Threat model](../security/THREAT_MODEL.md) and [deployment checklist](../security/DEPLOYMENT_CHECKLIST.md) apply. No arbitrary RCON/shell/Docker proxy, public management ports, child administration or model-dependent authorization. Secrets stay outside app projections, logs, queues and Git. Preserve worlds, manually stopped state and unrelated workloads.

## Acceptance criteria

- [ ] All phase task evidence and applicable MC gates pass in the claimed environment; unknown/manual gaps explicitly block readiness where critical.
- [ ] Full initial server-management dashboard scope including explicit lifecycle controls and multi-server operations, with auditable verified results and preserved data.
- [ ] Authorization, tenant/child denial, redaction, uncertain effects and preservation reviewed; no production actions inferred from local checks.
- [ ] Rollback/backup procedures rehearsed on disposable resources with exact evidence and current risk/ADR/status records.

## Rollback and backup

Follow [preservation procedures](../operations/minecraft-preservation.md). F0 inventory has no live writes; F1 unbinds only registration. Access changes use versioned compensation, backup failure preserves known-good copies, provisioning rollback removes only ownership-proven new runtime resources while retaining worlds/backups. Live writes require verified recovery, exact rollback and operator approval. Never overwrite/delete a real world to test a plan.

## Documentation and deliverables

Contracts/schema/API/SDK and operator instructions for implemented capabilities; exact checks/artifact/version evidence; [chapter review](../templates/chapter-review.md), risk register, status/build log and [handoff](../templates/agent-handoff.md). Every coherent build step commits only task changes and pushes origin main under AGENTS.md.

## Review checkpoint and next handoff

Review applicable security/recovery and acceptance evidence before authorizing the next phase. Documentation or fake-only proof is not production readiness. Report exact next task and outstanding production/manual gates; never silently cross a phase boundary. Preserve completed original chapters and source inputs.
