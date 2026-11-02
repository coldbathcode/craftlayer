# Current delivery status

Last updated: 2026-11-02.

## Authorized scope

The user’s “ok start building craftlayer!” after REC-01 authorizes F0 local implementation (now locally verified; review prepared). Contabo access, backup capture and production changes remain unauthorized. The user’s subsequent “go to the next steps” authorizes F1 local implementation. The user’s “continue” after the F1 review authorizes F2 local implementation and advancement from the F1 local preview. The user’s subsequent request to build VPS deployment/management authorizes local F2.5 and F3 capability development alongside F2. Release dependencies/security/recovery gates remain; no VPS access, enrollment, deployment or world writes are authorized. REC-01 documentation reconciliation is complete. The user's next-steps request after Chapter 02 still authorizes Chapter 03. Chapters 00–02 are accepted for advancement, not independent security certification. Chapter 04 requires authorization. Every coherent build step updates plans, commits/pushes origin main and verifies synchronization. Pre-existing unrelated modifications must be preserved and reported; do not manufacture a clean tree by committing or discarding them.

## Preserved runtime checkpoint

- Chapters 00–02 implemented/verified; [provider review](../reviews/02-provider-gateway.md), hosted final CI 41292488668 passed at base `9c9981b`.
- Chapter 03: CL-03-01 through CL-03-06 verified (6/7).
- Latest evidence: Completed scoped REST replay/SSE, encrypted user/session/org/environment/mission cursors, bounded snapshots/resync, strict event projections, browser-safe parser and reconnecting CLI watch. Current authority is rechecked before bounded enqueue; limits and backpressure bound connections/buffering. pnpm check passed 198 unit tests; final typecheck/lint/docs passed; pnpm test:db passed 85 database/API cases plus migration proofs. Actual HTTP and CLI watch prove replay/dedup, expired-cursor snapshot, foreign/tampered cursor denial, connection/origin caps, prompt session-revocation close and controlled socket-backpressure cleanup. Recovery checkpoint also proves old-fence rejection, no blind prepared-effect retry and exact-evidence conservative adult reconciliation. Recovery hosted CI 41319243310 passed. Actual Redis/container restart drill and final review remain CL-03-07.
- Next already-authorized coding task: CL-03-07; its dirty runtime/test changes were present before REC-01 and are not accepted/published as part of this documentation checkpoint.
- Read [Chapter 03](../chapters/03-fleet-engine.md), [ADR 0014](../architecture/decisions/0014-runtime-authority-and-recovery.md) and its runtime/data/security references before continuing.
- Main UI: http://127.0.0.1:3000/account. Preserve ignored credentials/volumes; preserve existing account state. Tests use disposable installations only.
- Branch/remote: main → https://github.com/coldbathcode/craftlayer.git. See [build log](build-log.md) for exact task evidence.
- Chapters 04–11 unimplemented; no live/paid inference, public deployment, real mail or Cloud implementation authorized.

## Unified management reconciliation checkpoint — REC-01

Documentation reconciliation delivered: [gap/reuse/conflict analysis](unified-reconciliation.md), [16-task F0–F3 track](minecraft-track.md), updated product/architecture/ADRs/backlog/roadmap, phase chapters, security/deployment and backup/rollback/acceptance procedures. This is a plan, not implemented Minecraft functionality. F1 observation preview is earliest dashboard; F2 verified access/backups is earliest family-ready management milestone; full lifecycle in F3 follows F2.5 provisioning. No models/bots required for F1/F2.

At REC-01 the first new management coding task ready **after F0 approval** was: CL-F0-01 local fixture-driven redacted read-only preflight. F0–F3 and Chapter 04 were then unimplemented/unapproved; current F0 implementation is recorded below. Exact production host state, Java/Bedrock compatibility, port isolation, backups and restoration are unverified. No VPS connection, deployment, container/world modification or destructive operation was performed.

Checks/publication evidence: see [REC-01 build-log entry](build-log.md) and [handoff](handoffs/REC-01-unified-reconciliation.md). Preserve all five pre-existing modified runtime/test files listed there. Main/remote equality can be verified independently of their intentionally dirty state; a clean whole working tree cannot be claimed.

## F0 implementation checkpoint — CL-F0-01 (historical)

Read-only local preflight implemented and verified with synthetic/recording fixtures: bounded no-shell local inspect/list/version/firewall reads, selected config fingerprints, explicit unknowns, redacted report and generic errors. No remote transport or mutable command capability. `pnpm check` passed 208 unit tests plus lint/boundaries/typecheck/docs; `sh -n scripts/preflight.sh` and `git diff --check` passed. [Operator runbook](../development/minecraft-preflight.md) records exact usage/limits.

Next within authorized F0: CL-F0-02 preservation manifest and disposable byte-recovery rehearsal, then F0 review. Existing Chapter 03 CL-03-07 is still open; its five entry-dirty files remain unchanged/excluded from this task commit. No production preflight, world/game/backup operation or network reachability/identity verification has run.

## Historical management checkpoint — F0 locally verified

CL-F0-01–02 complete in local scope. Final `pnpm check` passed lint/boundaries, strict source/test/web checks, 215 tests and docs validation; both shell syntax checks and whitespace checks passed. Read-only preflight plus stopped-source preservation manifests now exist; synthetic snapshot/isolated filesystem-copy recovery verifies original content and detects corruption/loss/rename/mode drift. Capture refuses running or changed bindings, unstable files, symlinks/hardlinks/special files and exceeded bounds. Reports never mark backup, game restore, family or production readiness verified. [F0 review](../reviews/F0-preflight.md), [runbook](../development/minecraft-preflight.md), [conditional remediation plan](../operations/minecraft-remediation.md) and [handoff](handoffs/F0-preflight.md) record evidence and limits.

Next management task: CL-F1-01 after **F1 authorization**; build registry/operation contracts/schema/permissions, private observation adapters and parent dashboard locally. No F1 implementation started. Separate Contabo read/backup/write approval remains required. Chapter 03 CL-03-07 and its five pre-existing modified files are still open/preserved, not completed by F0.

## F1 checkpoint — CL-F1-01

F1 authorized locally after F0 review. New strict contracts, scoped server/operation/outbox schema, permission seeds and management domain service implemented; no new HTTP routes/adapter/UI at this checkpoint. Registration is metadata-only with immutable target fingerprint, current guard, UUID replay/conflict and atomic audit/outbox. Viewer/Operator reads require explicit new scoped grants; children denied even with extra admin role. ADR 0017 records session-lock/FK and migration-upgrade decisions.

`pnpm check` passed 241 unit tests; `pnpm test:db` passed 95 integration cases including six new management cases and prior-tenant permission upgrade, plus repeat/rollback/checksum proofs. Database migrations ran only in disposable fixtures. Five pre-existing runtime/test files remain unchanged/excluded; Chapter 03 final review is still open. Next authorized task: CL-F1-02 protected read-only sources, observations, API/SDK. No Contabo/world/infrastructure operation performed.

## F1 checkpoint — CL-F1-02

Protected captured-inventory source and bounded literal-private-IP Java status adapter implemented; only fixed status handshake/request, no login/RCON/Docker/commands. Scoped REST/OpenAPI 3.1 and typed SDK expose target plans/adoption/status/players/activity, durable observations and unregister/reactivation metadata. Observations revalidate current authority and fence after I/O; expired attempts need explicit authorized refresh. Remote management fails closed pending private entry/MFA qualification. Optional Compose mounts only protected inventory into API; no actual main stack deployment or Contabo connection.

CL-F1-03 parent dashboard/browser review is next within authorized F1. Exact local check evidence is in the build log and [service runbook](../development/minecraft-management.md). Real identity/access/backup/world/remote/network gates remain unverified.

## Current management checkpoint — F1 local observation dashboard

CL-F1-01–03 implemented locally; [F1 review](../reviews/F1-control-plane.md) prepared for owner advancement. `/servers` reuses existing identity/account/RBAC/audit and typed API/SDK: approved-source plan/register, server/detail/player/activity views, provenance/freshness and explicit authentication/allowlist/network/backup gaps. Observe is bounded/read-only; unregister is registration metadata only, with exact-name UI confirmation. Children get no management UI; scoped viewers get reads without write controls. Polling reads stored metadata, and organization/session changes clear prior data. No provider/model is needed. Remote management remains blocked pending private entry/MFA qualification.

Final verification is recorded in [build log](build-log.md); local review/handoff distinguish synthetic browser/DB/source proof from unexecuted game/Contabo/network/restoration gates. No existing installation was migrated/restarted or deployed, no Minecraft world/container was touched. The five unrelated Chapter 03 runtime/test changes remain unchanged/excluded; CL-03-07 is still open.

Next management coding task **after F2 authorization**: CL-F2-01 pinned identity compatibility and safe enrollment, first on disposable approved fixtures. F2 is the earliest family-ready access/backup milestone; actual Java/Bedrock clients, unknown-player denial and isolated restore are required. F2.5 Docker enrollment/provisioning follows F2; F3 lifecycle follows that. No further phase or live-host action is authorized by this F1 checkpoint. [Handoff](handoffs/F1-control-plane.md).

## F2 in progress — CL-F2-01 checkpoint A

User’s “continue” authorizes local F2 and advancement from F1; no live-host authorization. Added strict identity/request contracts, exact Java UUID/Bedrock XUID mapping/continuity helpers and pinned **unqualified** artifact preparation. Fresh private temporary files only; no runtime/ports/worlds/EULA acceptance. Official candidate artifacts/hash/descriptor checks are separate from compatibility. [ADR 0018](../architecture/decisions/0018-game-identity-provenance.md) and [runbook](../development/minecraft-identities.md) document the boundary.

CL-F2-01 remains in progress. Next independent checkpoint B: scoped durable pending resolution requests/API; then authenticated bridge/explicit adult binding and required real client admission/denial/rename/spoof/link tests. Licensed test-client availability has been requested. No CL-F2-02 access mutation, backup, family release or production readiness is authorized by a fake-only pass. F2.5/F3 require later chapter authorization. Five unrelated entry-dirty files remain preserved.

## Current prototype checkpoint — F2 / CL-F2-01 B

User prioritised “something I can test and prototype asap”. A separate local prototype now runs at http://127.0.0.1:3001/servers with generated parent/viewer/child accounts, two explicitly simulated servers and real persistent pending identity requests/audit. [Prototype guide](../development/prototype.md) records start/refresh/stop, protected credentials and isolated volumes. Existing installation/Contabo/worlds remain untouched; no game server or paid provider is connected.

SQL 0017, canonical service/API/SDK and Players & access UI accept only scoped name-resolution requests, with UUID idempotency/current adult permission, immutable pending state and atomic operation/audit/reference-only outbox. They cannot promote verification or grant access. CL-F2-01 is still in progress: trusted authenticated bridge, explicit adult web-to-game binding and real Java/Bedrock compatibility evidence are next within authorized F2. CL-F2-02–04 and F2.5 are not completed by this prototype. Final exact checks/publication are in build log and [handoff](handoffs/F2-prototype.md). No next-chapter or production approval is inferred.

## VPS management development — CL-F25-01 checkpoint A

User requested additional capability usable for VPS deployment/management. Local F2.5/F3 development is authorized alongside F2; ADR 0019 retains F2/F2.5 release and production safety/recovery gates. No permission to connect/install/deploy on Contabo or alter existing worlds is inferred.

Implemented distinct project-bound node enrollment/credential/metadata-operation/outbox schema, current adult permissions and typed REST/SDK. A separate TLS 1.3 listener requires operator CA/client certificates, exact certificate fingerprint and Ed25519 proof; enrollments expire in five minutes, credentials in 24h, and rotation/revocation/replay checks apply per request. An outbound inventory-only agent uses fixed bounded Docker reads and private sequence journal. No physical command/provision/lifecycle/backup capability exists yet. [Node runbook](../development/minecraft-nodes.md) and ADR 0019 record limits; tests use local certificate fixtures and a separate disposable DB. Next checkpoint adds the Nodes dashboard and a real local-agent connection, then constrained provisioning plans/broker. F2 identity/access/recovery remains open and the five unrelated Chapter 03 edits stay preserved.

## VPS management development — CL-F25-01 checkpoint B

Hosts dashboard `/nodes`, optional loopback-only Compose gateway and actual local inventory agent now run in the separate prototype. Adult public-key/certificate approval, capacity/freshness, credential rotation and exact-name revocation reuse the canonical API; child/viewer denial and organization/session clearing remain enforced. Transient reconnect uses bounded backoff and retained fsynced sequence, while authentication/certificate failures stop. Explicit local prototype renewal revokes/replaces an expired identity with fresh credentials rather than extending trust. Game observations remain synthetic, and provisioning qualification remains false.

Checks and corrective findings are in build log; real local Engine reads and private gateway stop/start reconnection are separate from synthetic-capacity browser tests. No game container or world changed. CL-F25-01 remains open for signed physical commands/leases/fences; next authorized work is CL-F25-02 template plans and constrained broker. F2 identity/access/backup, real game restore, remote PKI/MFA and production gates remain open. See [handoff](handoffs/F25-hosts.md).

## VPS management development — CL-F25-02 checkpoint A

The Hosts dashboard now includes Family Survival deployment preview: select canonical Minecraft access scope, name and Java/Bedrock ports; inspect pinned candidate versions, declared memory/headroom, current host/report and occupied Docker bindings. New adult placement/provision permissions and strict API/SDK enforce tenant/project/child boundaries. Invalid/stale/disconnected/unbounded reports cannot become assumed capacity. Editing inputs clears the old result; calculated previews expire after 30s.

This is a usable planning flow, not server creation: dispatch is always unavailable, EULA remains false, and approved runtime image, actual identity/recovery, quotas, native ports/network, reservations and signed executor remain open. No resources are created/reserved, no worlds changed and no VPS contacted. Exact checks are in build log; [runbook](../development/minecraft-provisioning.md) and [handoff](handoffs/F25-plans.md) record the next task: signed node command journal/lease/fencing, then transactional reservations and constrained broker within existing local authorization. F2/F25 release and production gates remain intact.

Final publication/live check: remote main equals the published preview commit; task-owned changes are clean. Prototype :3001 is healthy with real capacity/planning. The older local :3000 app is unavailable because its original containers are already stopped; read-only inspection found exit times about eight hours earlier. It remains stopped and untouched. Preserved CL-03-07/review work still prevents a whole-tree clean claim.

## CL-F25-01 checkpoint C — local signed execution

User authorized continued local work through the plan with checkpoint commits/pushes. Added a private disabled-by-default execution library: strict signed reference-only jobs, fresh nonce-bound current permits, canonical target/policy/key/time checks, persistent intent/fences/credential floors/local stop and signed verified receipts. Unknown post-dispatch outcomes block conflicting work across restart/rotation; deadlines and clock rollback fail closed. Existing network protocol/agent remains inventory-only, with no new effect route.

Local deterministic/fault evidence includes a real child-process kill after dispatch intent; no Docker/game/world operation. ADR 0020/runbook record bounded journal limits, missing/corrupt-state refusal and unimplemented reconciliation/archival. Next authorized step is durable transactional reservations/current authority and the constrained broker. F2/F25 release, real identity/recovery and production access remain gated. Exact check results are in build log.
