# Chapter F2.5 review — secure nodes and Docker provisioning progress

**Implementation state:** partial, locally verified checkpoints. **Acceptance decision:** pending; chapter not complete. **Reviewer:** unassigned. **Date:** 2026-11-02 UTC. **Commit/tree:** executor `c13d7a0`, reservations `11499b2`, fixed Engine `38faeb5`, ownership `83a2af6`, real fixture `c043d38`; intake `d95d815`; controller B `1dfdca1`; outbound C `eefe57c`; remote D `e7ce53d`; split admission E publication follows this record. **Authorized scope:** continued local F2/F2.5/F3 checkpoints with publication per step; no production access/world changes or Chapter 04.

## Delivered behavior

[CL-F25-01/02/03](../chapters/F2.5-docker-provisioning.md) now provide private signed local execution, fresh nonce permits, durable local stop/fences/uncertainty, transactional resource/port reservations, fixed image/resource/network/mount policy, ownership-proven lifecycle/retained-world rollback and a disabled durable controller intake. Existing Hosts/planner prototype remains inventory/effect-free planning only. PR-025/028–033 and ADRs 0019–0023 remain the source contracts. No public provision action or production adapter is enabled.

## Acceptance evidence

| Requirement/task | Criterion and exact check | Result | Limits |
| --- | --- | --- | --- |
| CL-F25-01 / MC-01/06/10 | `pnpm check`: signed scope/time/nonce/stop/fence/journal fault checks | PASS/0, 349 unit cases overall | Existing ten executor cases plus current broker/contracts; fake current authority |
| CL-F25-02 / MC-07/10 | `pnpm test:db`: transactional reservation/port/budget/revocation checks | PASS/0, 157 integration cases overall plus migration proofs | Qualified admission/approval explicitly fake; no actual persistent quota |
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

Decision: pending. Next authorized local task: remote current-authority and qualified approval/world integration, following [handoff](../delivery/handoffs/F25-core-progress.md). This prepared progress review does not accept the chapter or authorize production.

CL-F25-03/B progress: `pnpm check` PASS/0 (342 unit cases/35 files) and `pnpm test:db` PASS/0 (150 cases/seven files plus migration proofs) cover private controller issuance/current grant/qualifier/node proof/receipt/expiry behavior. Eighteen new DB cases and two contract cases use explicitly fake qualification; no native effect or installed production transport is implied. ADR 0024 records key/identity isolation and remaining gates.

CL-F25-03/C: `pnpm check` PASS/0 (344 unit cases/36 files); `pnpm test:db` PASS/0 (151 cases/seven files plus migration proofs). Actual DB/TLS/Redis broker journey passes with temporary uninstalled PKI, explicit fake qualifier/approval and exact stopped-fixture cleanup. Optional gateway injection is not enabled by installed entrypoints. No game/world/EULA or production qualification.

CL-F25-03/D: `pnpm check` PASS/0 (347 unit cases/39 files), `pnpm test:db` PASS/0 (152 cases/seven files plus migration proofs). The native journey now uses remote identity proof with a gateway lacking identity service injection. Three unit cases cover strict proof purpose/private URL/separate signer; one extra DB case proves expired-proof rollback, while the existing real journey adds certificate/key/replay/cookie/digest/expiry/revocation denials. Process/container isolation and installed admission/issuer/qualification remain open. ADR 0025.

CL-F25-03/E: `pnpm check` PASS/0 (349 unit cases/40 files), `pnpm test:db` PASS/0 (157 cases/seven files plus migration proofs). SQL 0023 sealed-authority admission needs no control key; gateway issuance uses fresh remote identity without identity injection. Actual stopped Redis fixture uses the split. Five additional DB/two contract cases protect expiry/stop/original actor/session/immutable scoped grants and projections. HTTP/worker/polling/real qualification remain open.


CL-F25-03/F: isolated publication snapshot `pnpm check` PASS/0 (349 unit cases/40 files), `pnpm build` PASS/0 and `pnpm test:db` PASS/0 (156 integration cases/seven files plus migration proofs). Three new cases verify local metadata-only HTTP/SDK admission, strict required UUID headers/input, current dual adult permissions including revocation, Origin/CSRF, replay/atomic records, OpenAPI, actual loopback SDK job/operation/receipt projections, redaction, expiry/retained allocation, default qualifier denial, remote blocking and absent browser command/issuance routes. Four pre-existing uncommitted runtime cases are excluded from this isolated count; the initial combined-workspace run's one faulty post-revocation test assertion was corrected and is not a pass. API entrypoint now wires key-free metadata only; installed node/gateway is unchanged. Background dispatch/polling/expiry, production qualification and game/world release criteria remain open. No chapter acceptance or production deployment.

CL-F25-03/G: isolated `pnpm check` PASS/0 (349 unit cases) and `pnpm test:db` PASS/0 (160 cases plus migration proofs). Four new DB cases verify bounded immutable-outbox dispatch, concurrent/lost-ack/reopened scans, default qualification/current revocation/scope denial, cursor fairness and signature-bound conservative expiry/late evidence/retained allocation. Actual DB/remote-authority/TLS/scratch-Redis flow starts with the dispatcher. No installed effect path, new schema or Minecraft/production qualification. ADR 0026 and [handoff](../delivery/handoffs/F25-dispatch.md) preserve the remaining gates.

CL-F25-03/H: isolated `pnpm check` PASS/0 (351 unit cases), `pnpm test:db` PASS/0 (164 cases plus migration proofs). Four DB/network/two contract cases plus real TLS/native scratch journey verify exact signed discovery, peer/pin/key/scope/request/time binding, bounded replay/capacity, stop/expiry/credential/revoked-human-fetch denial and default inventory-only refusal. No effects or lease changes are granted by discovery; installed composition and game/production qualification remain open. ADR 0026 and [handoff](../delivery/handoffs/F25-polling.md).

CL-F25-03/I: isolated `pnpm check` PASS/0 (355 unit cases), `pnpm test:db` PASS/0 (164 cases plus migration proofs); targeted executor/runner PASS/0 (14 cases). Four new real-file cases cover receipt loss/reopen/expiry/revocation, stop-safe delivery, contradictory acknowledgement/uncertain-resource blocking and strict v1 journal upgrade. Native DB/remote-authority/TLS/scratch-Redis composition loses a settlement response after commit and reopens/drains without another create. Local journal v2 rollback requires preserving evidence and a forward compatible reader. Installed composition and real qualification remain open under ADR 0027; [handoff](../delivery/handoffs/F25-node-runner.md).

CL-F25-03/J (2026-11-04): private durable review-request foundation locally verified. Isolated `pnpm check` PASS/0 (357 unit/42 files) and `pnpm test:db` PASS/0 (184/seven plus SQL 0026 migration proofs). Eight-way replay, exact canonical resource/hash/private original-grant binding, immutable pending-only metadata, expiry/no renewal, current original/session/child/tenant denials, stop/node revocation, no implicit qualification/effects and SQL tamper/RLS/outbox isolation are covered. Requests remain unverified and execution-disabled. Independent decisions/revocation, actual approval/host/game/recovery evidence and installed composition remain open; F25 acceptance is still withheld. [ADR 0030](../architecture/decisions/0030-durable-deployment-review-requests.md); [handoff](../delivery/handoffs/F25-review-requests.md).

CL-F25-03/K1 completes the private independent-adult identity prerequisite: one transaction validates both current principals with stable lock order and final all-principal expiry/clock rollback checks. Eleven added real database cases include twelve concurrent reversed pairs, both-side revocation and actual lock-wait faults; final exact suite/build results and initial typing correction are in the build log. The unfinished entry auth patch is deliberately completed here. Durable exact-review decisions/rejections/revocation remain the next checkpoint; no route, qualifier, installed effect or chapter acceptance is added. [Handoff](../delivery/handoffs/F25-independent-authority.md).

CL-F25-03/P1 responds to the user's playable-VPS priority with a separate operator Java test bundle. Unit safety/artifact checks, the real pinned Paper download and Compose parsing are recorded in the build log. No game boot, allowed/denied licensed client, backup/restore, host quota, VPS discovery or deployment has occurred. EULA remains false; player/VPS details are pending. This is preparation, not chapter acceptance or a platform approval bypass. [ADR 0031](../architecture/decisions/0031-operator-playtest-first.md) and [handoff](../delivery/handoffs/F25-playable-vps.md) establish the new immediate sequence.

CL-F25-03/K2 (2026-11-07): private independent decisions, rejection, revocation and pre-use revalidation locally verified. `pnpm check` PASS/0 (365 unit/44 files); `pnpm test:db` PASS/0 (211 cases/7 files plus migration proofs). Targeted mutation run is in the build log. Evidence only: no qualifier, route, installed path or real host/game/identity/recovery proof, and F25 release criteria remain incomplete.
