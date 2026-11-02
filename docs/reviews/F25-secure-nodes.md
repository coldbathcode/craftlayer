# Chapter F2.5 review — secure nodes and Docker provisioning progress

**Implementation state:** partial, locally verified checkpoints. **Acceptance decision:** pending; chapter not complete. **Reviewer:** unassigned. **Date:** 2026-11-02 UTC. **Commit/tree:** executor `c13d7a0`, reservations `11499b2`, fixed Engine `38faeb5`, ownership `83a2af6`, real fixture `c043d38`; intake `d95d815`; controller B publication follows this record. **Authorized scope:** continued local F2/F2.5/F3 checkpoints with publication per step; no production access/world changes or Chapter 04.

## Delivered behavior

[CL-F25-01/02/03](../chapters/F2.5-docker-provisioning.md) now provide private signed local execution, fresh nonce permits, durable local stop/fences/uncertainty, transactional resource/port reservations, fixed image/resource/network/mount policy, ownership-proven lifecycle/retained-world rollback and a disabled durable controller intake. Existing Hosts/planner prototype remains inventory/effect-free planning only. PR-025/028–033 and ADRs 0019–0023 remain the source contracts. No public provision action or production adapter is enabled.

## Acceptance evidence

| Requirement/task | Criterion and exact check | Result | Limits |
| --- | --- | --- | --- |
| CL-F25-01 / MC-01/06/10 | `pnpm check`: signed scope/time/nonce/stop/fence/journal fault checks | PASS/0, 342 unit cases overall | Existing ten executor cases plus current broker/contracts; fake current authority |
| CL-F25-02 / MC-07/10 | `pnpm test:db`: transactional reservation/port/budget/revocation checks | PASS/0, 150 integration cases overall plus migration proofs | Qualified admission/approval explicitly fake; no actual persistent quota |
| CL-F25-02/03 / MC-06/08/11 | `pnpm check`: recording Engine ownership/config/fault/process-death cases | PASS/0, fifteen Engine plus thirteen runner cases | Real child kill against recording Engine, not a real game |
| CL-F25-02/03 / MC-06/08/11 | `pnpm test:node:broker`: actual signed Redis scratch fixture lifecycle/compensation/unknown ack/preservation | PASS/0 with exact fixture cleanup | Local Unix Docker, no Minecraft image/world; harness captures IDs separately |
| CL-F25-03/A / MC-01/06/10 | `pnpm test:db`: durable disabled intake, replay/reopen/scope/revocation/stop/RLS/SQL binding | PASS/0, nine new cases included above | No installed worker/transport/effect path |
| F2/F25 family release | Real Java/Bedrock identity/allowlist, consistent backup/isolated restore, persistent world hard quota, remote firewall/control/MFA | NOT RUN / release blocked | Requires qualified fixtures/operator/client evidence and explicit production authorization |

Pinned Node 22.23.3/pnpm 10.23.0/PostgreSQL 18, macOS arm64, Docker 28.2.2/Engine API 1.50, committed Redis image digest. No paid inference, Cloud, EULA acceptance, world change or Contabo access. Exact commands/corrections are in [build log](../delivery/build-log.md).

## Safety and failure review

Current adult scope/tenant/session checks and forced RLS protect metadata. Fixed node verbs reject arbitrary commands/mounts/public bindings and existing-resource adoption. Private native intents/returned IDs and immutable world bindings survive crash/reopen; unknown effects retain allocations and block new work, including after rotation. Graceful stop has no forced kill; removal retains volumes and refuses running/drifted resources. Agent socket privilege still means potential host compromise. No external I/O runs in the new short intake transaction. No API/web/general worker gets Docker access or signing keys.

Actual current authority/independent approval/stop transport, durable physical job settlement/reconciliation/archival, persistent-world allocation/quota, game configuration/readiness/ingress and backup/restore are still absent. Test signatures and tmpfs limits cannot qualify them. No exactly-once effect or production-ready claim.

## Performance and user verification

No new UI in these checkpoints; existing prototype `/nodes` and `/servers` remains separate on localhost:3001. No browser rerun is claimed for private library/schema-only changes. Recording checks are deterministic; real fixture asserts isolation flags, Redis readiness, scratch exhaustion and preservation. No chapter-wide NFR/remote-host performance acceptance is claimed.

## Known limitations and unresolved work

Bounded local journals (execution 128 commands/512 KiB, ownership 128 deployments/1 MiB) have no archival/force-clear. Intake stays immutable pending metadata; controller B supplies a separate first-command lease/signer/current-permit/receipt core. Installed network/remote authorizer/real qualifier/cancellation/archival remains absent. Allocated/uncertain world/port claims remain retained after runtime cleanup. Production qualifiers and licensed clients/recovery gates remain open; read-only Contabo permission/target is unanswered. Preserved concurrent Chapter 03/review edits prevent whole-tree cleanliness; task-only publications exclude them.

## Review decision and handoff

- [ ] Required chapter task evidence complete.
- [ ] All acceptance criteria met or explicit amendment reviewed.
- [ ] No unresolved blocking release issue.
- [x] Implemented checkpoint docs/backlog/status/ADRs updated consistently.

Decision: pending. Next authorized local task: outbound transport/end-to-end fixture and remote current-authority integration, following [handoff](../delivery/handoffs/F25-core-progress.md). This prepared progress review does not accept the chapter or authorize production.

CL-F25-03/B progress: `pnpm check` PASS/0 (342 unit cases/35 files) and `pnpm test:db` PASS/0 (150 cases/seven files plus migration proofs) cover private controller issuance/current grant/qualifier/node proof/receipt/expiry behavior. Eighteen new DB cases and two contract cases use explicitly fake qualification; no native effect or installed production transport is implied. ADR 0024 records key/identity isolation and remaining gates.
