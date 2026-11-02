# F0 — Preservation and read-only preflight

**Status:** planned; implementation not authorized by REC-01. **Milestone:** F0. **Requirements:** PR-023, PR-028–029. No production evidence exists.

## Objective

An operator can review a sanitized, non-destructive report and recovery/remediation plan with every unknown explicit. No existing server/container/world is changed.

## Dependencies and entry gate

Explicit F0 coding authorization; Chapters 00–01 evidence. Production inspection and backup require distinct operator authorization.

Read AGENTS.md, current status, [track](../delivery/minecraft-track.md), [management architecture](../architecture/minecraft-management.md), security and preservation references. Inspect Git status and preserve unrelated work. Each phase is a separately authorized chapter boundary.

## Ordered engineering tasks

### [ ] CL-F0-01 — Fixture-driven redacted read-only preflight

**Depends on:** F0 coding authorization. **Status:** not started. **Size:** L.

**Implementation:** Implement local scripts/preflight.sh with bounded allowlisted read collection and schema-versioned redacted output. Record Docker state/IDs/mounts/ports, Paper/Geyser/Floodgate/auth/allowlist metadata, effective firewall evidence, disk and backup unknowns. No SSH automation, mutation, repair or game start.

**Required evidence:** Recording fake runner proves zero mutation calls, stopped/unrelated state preserved, secret canaries absent even on malformed input/errors, missing tools/privileges reported unknown. See MC-02 and the first-task specification in the track.

### [ ] CL-F0-02 — Preservation manifest and recovery/remediation plan

**Depends on:** CL-F0-01. **Status:** not started. **Size:** L.

**Implementation:** Define stable world/container/config fingerprint, inventory comparison and backup/isolated-restore rehearsal on disposable data. Produce prioritized reversible security fixes with exact live approval gates. Production details remain unknown until approved inspection.

**Required evidence:** MC-02/05/08 rehearsal reports stable source hashes, isolated recovery and no production changes; report backup gaps rather than claiming a live backup. Approved inventory/backup evidence is required later before live writes.

## Test plan

MC-02 collector/redaction and preservation; MC-05 exposure evidence; MC-08 disposable restore rehearsal. No production connection in routine checks. See [acceptance matrix](../testing/minecraft-management.md) for exact scenarios and required real/manual evidence. Add test commands only with implementation; do not claim existing commands exercise new features.

## Security considerations

[Threat model](../security/THREAT_MODEL.md) and [deployment checklist](../security/DEPLOYMENT_CHECKLIST.md) apply. No arbitrary RCON/shell/Docker proxy, public management ports, child administration or model-dependent authorization. Secrets stay outside app projections, logs, queues and Git. Preserve worlds, manually stopped state and unrelated workloads.

## Acceptance criteria

- [ ] All phase task evidence and applicable MC gates pass in the claimed environment; unknown/manual gaps explicitly block readiness where critical.
- [ ] An operator can review a sanitized, non-destructive report and recovery/remediation plan with every unknown explicit. No existing server/container/world is changed.
- [ ] Authorization, tenant/child denial, redaction, uncertain effects and preservation reviewed; no production actions inferred from local checks.
- [ ] Rollback/backup procedures rehearsed on disposable resources with exact evidence and current risk/ADR/status records.

## Rollback and backup

Follow [preservation procedures](../operations/minecraft-preservation.md). F0 inventory has no live writes; F1 unbinds only registration. Access changes use versioned compensation, backup failure preserves known-good copies, provisioning rollback removes only ownership-proven new runtime resources while retaining worlds/backups. Live writes require verified recovery, exact rollback and operator approval. Never overwrite/delete a real world to test a plan.

## Documentation and deliverables

Contracts/schema/API/SDK and operator instructions for implemented capabilities; exact checks/artifact/version evidence; [chapter review](../templates/chapter-review.md), risk register, status/build log and [handoff](../templates/agent-handoff.md). Every coherent build step commits only task changes and pushes origin main under AGENTS.md.

## Review checkpoint and next handoff

Review applicable security/recovery and acceptance evidence before authorizing the next phase. Documentation or fake-only proof is not production readiness. Report exact next task and outstanding production/manual gates; never silently cross a phase boundary. Preserve completed original chapters and source inputs.
