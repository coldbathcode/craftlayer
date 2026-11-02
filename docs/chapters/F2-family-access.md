# F2 — Verified family access and recoverable backups

**Status:** planned; implementation not authorized by REC-01. **Milestone:** F2. **Requirements:** PR-025–029, PR-035. No production evidence exists.

## Objective

Earliest family-ready dashboard: approve/revoke verified identities, deny unknown Java/Bedrock players, show players/access/backup health, create recoverable backups and inspect audit with no LLM. Stop/restart unavailable until F3; full initial feature set then follows.

## Dependencies and entry gate

Explicit F2 authorization and F1 gate. Work first on disposable pinned Paper/Geyser/Floodgate fixtures. No production write until backup, restore, exact rollback and operator approval exist.

Read AGENTS.md, current status, [track](../delivery/minecraft-track.md), [management architecture](../architecture/minecraft-management.md), security and preservation references. Inspect Git status and preserve unrelated work. Each phase is a separately authorized chapter boundary.

## Ordered engineering tasks

### [ ] CL-F2-01 — Pinned identity compatibility and safe enrollment

**Depends on:** F1 gate. **Status:** not started. **Size:** L.

**Implementation:** Select and record compatible immutable server/image/plugins and real Java/Bedrock authentication flow. Add verified edition/UUID/XUID provenance, explicit web-to-game identity binding and safe first-time resolution. Unresolved names remain pending; unsupported Floodgate behavior blocks rather than bypasses auth.

**Required evidence:** MC-03: actual approved test clients/accounts prove unknown rejection, approved admission, rename/spoof/link-change handling and no whitelist-off enrollment window. Fakes alone cannot close this task’s real compatibility gate.

### [ ] CL-F2-02 — Desired and actual allowlist operations and UI

**Depends on:** CL-F2-01. **Status:** not started. **Size:** L.

**Implementation:** Add scoped adult allow/revoke/temporary access, explicit kick operation and desired/observed policy versions/states. Worker revalidates authority before fixed typed adapter action; verify actual readback and rejoin denial. Audit success/failure/denial and operation status. No child OP/access/lifecycle rights.

**Required evidence:** MC-01/04/06/12: pending/applied/failed/drifted UI, revoke/expiry/retry across restart, concurrent edits and lost-ack uncertainty; zero unauthorized effects. Revocation and kick remain separate.

### [ ] CL-F2-03 — Consistent scheduled backups and isolated restore

**Depends on:** CL-F2-02. **Status:** not started. **Size:** L.

**Implementation:** Implement adult-approved revocable backup policy/grant, daily occurrences with timezone, 14-day minimum retention, weekly encrypted off-host copy and separated recovery keys. Save-consistent archive/manifest/integrity, bounded save-on recovery and health. Restore only isolated instances first; guarded production restore remains disabled until approved.

**Required evidence:** MC-08/06: schedule replay/DST/outage, save/worker failure, corrupt/missing-key/low-disk/path-escape denials, retained known-good backup, checksum + nontrivial isolated boot/world verification and measured RPO/RTO.

### [ ] CL-F2-04 — Family release gate and recovery handoff

**Depends on:** CL-F2-03. **Status:** not started. **Size:** L.

**Implementation:** Complete parent access/backup/audit UI and evidence matrix; expose no lifecycle until broker qualification. Review security checklist, no-provider operation, preservation, manual client/network/accessibility gaps and exact production remediation proposal.

**Required evidence:** Applicable MC-01–06/08/12 and deployment checklist pass for claimed environment. Contabo family-ready remains unverified without separately approved inventory/remediation plus real identity/restore/network evidence. Review may not mark unknowns passed.

## Test plan

Complete family acceptance using actual pinned game clients and isolated restores as well as deterministic fake failures. All mutations durable/idempotent and scoped; each unknown blocks relevant readiness. See [acceptance matrix](../testing/minecraft-management.md) for exact scenarios and required real/manual evidence. Add test commands only with implementation; do not claim existing commands exercise new features.

## Security considerations

[Threat model](../security/THREAT_MODEL.md) and [deployment checklist](../security/DEPLOYMENT_CHECKLIST.md) apply. No arbitrary RCON/shell/Docker proxy, public management ports, child administration or model-dependent authorization. Secrets stay outside app projections, logs, queues and Git. Preserve worlds, manually stopped state and unrelated workloads.

## Acceptance criteria

- [ ] All phase task evidence and applicable MC gates pass in the claimed environment; unknown/manual gaps explicitly block readiness where critical.
- [ ] Earliest family-ready dashboard: approve/revoke verified identities, deny unknown Java/Bedrock players, show players/access/backup health, create recoverable backups and inspect audit with no LLM. Stop/restart unavailable until F3; full initial feature set then follows.
- [ ] Authorization, tenant/child denial, redaction, uncertain effects and preservation reviewed; no production actions inferred from local checks.
- [ ] Rollback/backup procedures rehearsed on disposable resources with exact evidence and current risk/ADR/status records.

## Rollback and backup

Follow [preservation procedures](../operations/minecraft-preservation.md). F0 inventory has no live writes; F1 unbinds only registration. Access changes use versioned compensation, backup failure preserves known-good copies, provisioning rollback removes only ownership-proven new runtime resources while retaining worlds/backups. Live writes require verified recovery, exact rollback and operator approval. Never overwrite/delete a real world to test a plan.

## Documentation and deliverables

Contracts/schema/API/SDK and operator instructions for implemented capabilities; exact checks/artifact/version evidence; [chapter review](../templates/chapter-review.md), risk register, status/build log and [handoff](../templates/agent-handoff.md). Every coherent build step commits only task changes and pushes origin main under AGENTS.md.

## Review checkpoint and next handoff

Review applicable security/recovery and acceptance evidence before authorizing the next phase. Documentation or fake-only proof is not production readiness. Report exact next task and outstanding production/manual gates; never silently cross a phase boundary. Preserve completed original chapters and source inputs.
