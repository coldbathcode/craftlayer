# Minecraft management, operations and node architecture

Status: staged F-track contract; F1 and F2 pending identity request/prototype checkpoints are implemented, with real F2 access/recovery/node gates still open. [Reconciliation](../delivery/unified-reconciliation.md), [ADR 0015](decisions/0015-unified-control-plane.md) and [ADR 0016](decisions/0016-node-provisioning-boundary.md) preserve implemented Chapters 00–03. Detailed bot play remains in [Minecraft cooperation](minecraft-cooperation.md).

## Components and trust boundaries

Browser / REST / later MCP → current Fastify auth/policy → management domain services → scoped PostgreSQL operation/audit/outbox → private control adapter or outbound node. PostgreSQL owns desired state; Redis is at-least-once dispatch only. Node reports are observations, never authority to change tenancy or policy. Bot workers are a separate process/credential domain.

Reuse `packages/core` policy and clocks, `packages/contracts` strict JSON-safe Zod schemas, `packages/auth` private identity guards, `packages/db` additive migrations, `packages/sdk` public transport and `apps/web` account shell. Introduce `packages/minecraft-control` for framework-independent management services/ports, and `services/minecraft-control` / `services/minecraft-node` only when implemented. Do not rename `packages/runtime`/`providers` to match an illustrative input tree. Existing queue/repository patterns may be extracted only when justified; simulation SQL/mission grants are not directly reusable as server authority.

F1 adapter declares an allowlist of observation capabilities. Status may come from private server query or approved read-only RCON verbs; RCON itself is privileged, so its secret stays in the isolated adapter with fixed verbs and no client-controlled command fragments. A stopped/offline server reports unavailable; never start it to satisfy health. No world mounts or Docker socket in API/web/MCP/workers. F0 inventory is an operator-run inspection tool, not a continuously privileged API feature.

F2 adds fixed UUID-aware access/save actions and scoped backup access only after approved private connectivity and local policy setup. Prefer a pinned Paper/Floodgate bridge if RCON cannot establish identity or postconditions. Fail unsupported capability rather than guess. F2.5 node adds Docker privileges under ADR 0016; F3 enables approved lifecycle for adopted servers separately. Adoption registry writes do not confer container ownership.

## Additive data and scope

All new tenant tables carry organization and project IDs with composite FKs, forced RLS and transaction-local context under restricted roles. Server maps one Minecraft environment to a stable server/world identity; server access does not grant bot actions, nor the reverse. Never use a world path/container name from a request as authority.

| Aggregate | Planned durable data / constraints |
| --- | --- |
| `nodes`, `node_enrollments`, `node_credentials` | Org/project binding, pinned public key, capability/protocol, local policy, certificate version/revocation, heartbeat and capacity observation time; hashed one-use enrollment expiry |
| `servers`, `server_configurations` | Org/project/environment, node/control adapter, `adopted` or `provisioned`, immutable container/volume/world mapping, observed version/freshness, desired state, read-only default; unique active binding per host/container |
| `player_identities`, `server_player_access` | Edition, verified immutable UUID/XUID mapping, issuer/provenance/time/version, names as display; explicit adult-to-game-account binding, desired access version/expiry, observed state/time; unique server/identity |
| `operations`, `operation_attempts`, `operation_receipts` | Principal/session or approved bounded schedule grant, exact scope/input/plan hash, idempotency identity, approval, state, stop generation, monotonic fence, deadline, redacted result/error and evidence references |
| `management_outbox`, `management_events` | Atomic intent/audit/event and reference-only dispatch; bounded authorized projections/cursors independent of mission-only event payloads |
| `scheduled_jobs`, `backup_policies`, `backups` | Adult-approved server-scoped schedule/timezone, revision/revocation, due occurrence ID, lease; archive manifest, consistency proof, checksum/encryption/key reference, retention/legal hold if configured, off-host state, last restore proof |
| `service_accounts`, `api_credentials`, `oauth_clients` | F25 scoped non-human principals and OAuth client bindings; hashed/revocable/expiring tokens, canonical org/project/server/resource restrictions, no browser-session or node-certificate reuse |
| `deployments`, `node_reservations` | Immutable deployment ID, plan digest, approved image/plugin manifest, EULA record, reserved ports/CPU/RAM/disk, ownership resources; unique active node/protocol/address/port reservation |

Do not create all tables at once. F1 introduces server/operation/observation scope; F2 introduces identities/backups/schedules; F2.5 nodes/reservations/deployments. Node bootstrap credentials and RCON secrets are protected separately with purpose-separated encryption/associated data and node-local restrictive storage. They never appear in queue payloads or API projections. Audit remains the existing append-only history, extended additively for service actor, request/correlation, source and redacted outcomes; no parallel audit silo.

## Permission contract

New colon permissions are proposed; existing permission catalog/role seeds do not yet contain them. Add through tested migrations/policy changes, never by relaxing `environment:admin` globally.

| Capability | Canonical permissions | Default authority |
| --- | --- | --- |
| Observe assigned server | `server:read`, `player:read`, `world:read`, `backup:read`, `operation:read` | Adult Org Admin or explicitly scoped adult Viewer/Operator; child sees only assigned safe connection/status projection with explicit grant |
| Adopt/register | `server:adopt`, `server:create` | Adult Org Admin scoped to project; dry-run and explicit mapping |
| Access/moderation | `player:allow`, `player:revoke`, `player:kick`, `player:ban` | Adult Org Admin or scoped Player Manager; ban/access-policy change requires exact high-risk approval |
| Backup | `backup:create`, `backup:restore`, `backup:policy` | Adult scoped backup authority; restore requires exact approval; child denied even create/read archive |
| Node / provision | `node:read`, `node:enroll`, `node:rotate`, `node:revoke`, `node:deploy`, `server:provision` | Adult Org Admin with explicit project and node placement grant; child/bot denied |
| Lifecycle / update / decommission | `server:lifecycle`, `server:update`, `server:delete`, `world:modify` | Explicit adult scoped grant; high-risk approval and preservation checks |

Instance Owner still requires org membership for ordinary org data. New Server Operator and Player Manager role templates are scoped, adult-only, without role/node/credential administration by default. Automation principal has no provisioning/delete/restore by default. Scheduled backups use a revocable server-only service grant created by adult approval, bound to policy version and permitted save/archive actions, with current membership/policy/node checks at dispatch; they do not depend on an indefinitely live browser session. Revoke/disable freezes future runs and reports overdue health.

Child ceilings apply at API, service, queue and node even if extra roles exist: no lifecycle, access changes, backups, provisioning, credentials, raw logs, world/security settings or infrastructure. Agent Stop All is distinct from stopping Minecraft. Management high-risk approvals bind requester, independent adult approver, action/server/node/world, exact plan/config/archive hashes, policy versions, expiry and one-use consumption. The runtime's existing independent-approval semantics are preserved; single-parent deployments cannot bypass them with a requester self-approval shortcut. Provide a second authorized adult or leave such operations unavailable.

## Durable operation protocol

1. Authenticate current principal/membership; canonical server/node/project lookup; check permission/account ceiling, expected version, policy and applicable stop/approval. Cookie writes retain exact Origin/CSRF. A client organization header is only a selector.
2. Require UUID `Idempotency-Key` for mutations, including adoption, policy writes and credential workflows. Atomically store actor/org/route/key/body hash, durable operation, audit and outbox. Same input replays the operation reference under current read authority; changed input conflicts. Respond 202 with operation ID; never claim applied from enqueue.
3. Worker reloads canonical intent/current authority; lease/fence and bounded deadline authorize the typed effect. No SQL transaction spans network/Docker/RCON. Queue hints contain IDs/schema version only, never credentials or raw paths.
4. Isolated adapter/node independently verifies target binding, command schema/capability, signature/expiry, current node policy and fence before effect. Store intent/receipt around dispatch. Stop/revocation prevents new effects; acknowledged receipt and observed postcondition are separate.
5. Commit verified result and redacted audit/event using current fence; stale results cannot overwrite. Network timeout after dispatch becomes `uncertain`, blocks conflicting work and retains reservations until actual-state reconciliation or independent adult evidence proves safe retirement. No blind replay.
6. On restart, discover already-created resources by deployment ID/ownership journal, recheck container and world identity, compare actual state, repair dispatch only for known non-dispatch, and surface drift. Never auto-start a manually stopped server or clear a durable stop.

Generic states: `requested`, `validating`, `awaiting_approval`, `queued`, `running`, `verifying`, `succeeded`, `failed`, `uncertain`, `cancel_requested`, `cancelled`, `rolling_back`, `rolled_back`, `degraded`. Only verified postconditions yield success. Deployment stages additionally record `reserving`, `pulling`, `creating_storage`, `configuring`, `starting`; registry visibility before readiness is pending, never falsely ready. Cancellation stops future steps and performs only ownership-proven cleanup; unknown effects stay uncertain.

Management dispatch honors durable instance/org/environment safety stops; adapt current latch lookup without turning server operations into missions. A latched bot stop must not power off the game server. Safety reads and explicitly approved recovery remain available; automatic jobs cannot clear stop. Expiring access grants must remain visibly overdue/unsafe if revocation cannot apply during an outage/stop; readiness is removed until reconciled. Node certificates/reconnect never resume stopped operations automatically.

## REST and MCP contracts

All below are planned `/api/v1` additions, strict Zod/OpenAPI 3.1 with cursor pagination, scoped rate/size limits and durable operation responses for mutations. Keep implemented `/audit`, `/events`, `/stop-operations` and error envelope compatible. Validate OpenAPI version and SDK coverage explicitly; current Swagger registration is not proof of full 3.1 conformance.

| Routes | Behavior |
| --- | --- |
| `GET /servers`, `/servers/:id`, `/servers/:id/status` | Scoped registry and timestamped observation, unknown/offline/degraded distinct |
| `POST /servers/adopt/plan`, `POST /servers/adopt` | Non-effecting dry-run then in-place registry binding; `/servers` POST, if provided, is registration only and delegates here |
| `GET /servers/:id/players`, `/allowlist`, `/world`, `/metrics`, `/logs` | Capability-filtered bounded projections; no raw chat/config/secrets; logs/metrics expand in F3 |
| `POST /servers/:id/allowlist`, `DELETE /servers/:id/allowlist/:identityId` | Desired add/revoke with identity verification; never accept gamertag alone as verified authority |
| `POST /servers/:id/players/:identityId/kick`, `/ban` | Separate typed moderation; revoke does not silently kick |
| `GET, POST /servers/:id/backups`, `POST /servers/:id/backup` | Plural canonical; singular backup alias required by AGENTS delegates to the same operation/idempotency namespace, never double-schedules |
| `PUT /servers/:id/backup-policy`, `PATCH /servers/:id/world/rules` | Adult versioned backup schedule/policy in F2; allowlisted world settings in F3, never arbitrary file/config editing |
| `POST /servers/:id/restores` | Canonical restore action with backup ID/approval; no parallel nested restore endpoint needed |
| `GET /operations/:id`, `GET /servers/:id/deployment` | Authorized operation stage, attempts, failure/uncertainty and verified deployment |
| `GET /nodes`, `POST /nodes/enrollments`, `GET /nodes/:id/capacity` | Enroll exchange is authenticated to its one-use bootstrap identity; generic `POST /nodes` if added delegates to enrollment, never arbitrary trust registration |
| `POST /nodes/:id/rotate`, `/revoke` | Adult-approved credential state changes and bounded node exchange |
| `GET /server-templates`, `POST /servers/provision/plan`, `/servers/provision` | Validated immutable dry-run and confirmed provision; `server:provision` plus `node:deploy` |
| `POST /servers/:id/start`, `/stop`, `/restart`, `/update/plan`, `/update`; `DELETE /servers/:id` | F3 adopted-server lifecycle/update/decommission; F2.5 limited new-resource lifecycle for qualification; data retained |

MCP starts with F2.5 qualification after F2; it is not on the F1/F2 critical path. Use official TypeScript SDK and authenticated Streamable HTTP with issuer/signature/expiry/audience/resource/scope validation and discovery; pin protocol/SDK at implementation. Remote auth is mandatory for CraftLayer even if optional in the generic protocol. A browser session or node certificate is not an MCP access token. Optional stdio uses a narrow scoped local credential, no host ownership assumption.

Canonical read tools: `list_nodes`, `get_node_capacity`, `list_server_templates`, `list_servers`, `get_server_status`, `get_deployment_status`, `list_players`, `list_backups`, `get_operation_status`. Mutations: `provision_minecraft_server`, `adopt_minecraft_server`, `create_backup`, `start_server`, `stop_server`, `restart_server`, `allow_player`, `revoke_player`, `kick_player`, gated by phase capabilities. Input synonyms `list_minecraft_servers`, `*_minecraft_server`, `create_server_backup` are not additional tools. Use one canonical tool per behavior. Restore/delete/firewall/paid host creation disabled by default; human approval cannot be supplied by model text or the tool caller. Provisioning from machine/MCP always needs exact independent adult approval. REST, MCP and node delegate to the same domain policy; none is privileged bypass. F3 may add typed world-time/weather/rules and approved ban workflows plus `get_world_info`/`get_server_metrics`; player groups and richer world settings remain bounded F3 extensions, never raw commands.

## Provisioning validation and rollback

Family Survival template: target registered node label `contabo` only after resolution, Paper + vetted Geyser/Floodgate compatibility set, 4 GiB heap with independently validated container/host overhead, pvp off, command blocks off, online auth and enforced default-deny allowlist, empty OPs, daily backups/14-day retention/weekly encrypted off-host copy, retained storage. Example CPU/RAM values are requests, never evidence of Contabo capacity. EULA is false until explicit adult acknowledgement.

Before allocation check CPU/RAM/disk/headroom and storage enforcement support, architecture/Docker version, health/freshness, reserved and actual occupied ports across all containers/processes/addresses/protocols, image digest/signature policy, plugin checksum/protocol compatibility, trusted artifact source, controlled storage root/realpath/symlink boundaries, world uniqueness, network restrictions, tenant/node grants and quotas. No arbitrary host paths, plugins, images or shell from a caller. If hard disk quota enforcement is unavailable, reject templates requiring it or gate support; an alert alone is not a hard quota.

Lock/reserve capacity and protocol/address/ports transactionally with expiry and heartbeat; revalidate actual host state before create. Journal immutable IDs/labels and secret references. Never hold a transaction during image pull. Install identity policy and empty strict allowlist before game ingress. Verify readiness, private management ports and backups; separate process-running, game-ready and family-ready. On failure follow [preservation runbook](../operations/minecraft-preservation.md); retain worlds and never remove pre-existing/unlabelled resources. Tests are defined in [management acceptance](../testing/minecraft-management.md).

## Implemented F1 local preview

The [management runbook](../development/minecraft-management.md) describes implemented contracts. `packages/minecraft-control` owns scoped registry/operation/projection logic independently of Fastify, queues and UI. PostgreSQL migration 0016 adds server/operation/reference-only outbox state without changing existing agent runtime tables. Protected captured inventory and optional fixed Java status-only query are the implemented observation capabilities; no RCON adapter exists in F1. Captured offline remains offline; failed status is unavailable. No source can start an offline server or prove authentication/backup recovery.

`/servers` is a browser-only SDK consumer using existing same-origin identity/CSRF and JSON-safe schemas. Organization/world changes clear cached server/player/activity projections and invalidate late reads; periodic visible-tab metadata refresh never automatically issues a game query. The UI separates exact-plan metadata registration from future provisioning, requires typed confirmation for unregister, and leaves game/admin/backup controls unavailable. Current API/domain checks remain authoritative even when a control is absent or stale. Remote management is denied until separately qualified private entry/MFA; the local dashboard is no deployment approval. [F1 review](../reviews/F1-control-plane.md) records acceptance scope and manual gaps.

## Implemented F2 pending prototype boundary

Migration 0017 adds immutable pending name-resolution requests, canonical actor/session scope, current `player:enroll` and explicit `player:read`, durable operation receipts and atomic audit/reference-only outbox. No consumer promotes identity or grants access. `/servers/:id/identity-enrollments` GET/POST and typed SDK/UI expose pending/expired metadata only. The separate loopback prototype uses generated accounts and synthetic flagged snapshots; it cannot contact a real game server. [Prototype guide](../development/prototype.md) documents isolation and retained data; [ADR 0018](decisions/0018-game-identity-provenance.md) preserves authenticated-provenance/link-review requirements.

### CL-F25-01/B implementation boundary

The optional node-control Compose service holds only runtime DB/TLS/control-signing credentials and accepts mTLS enrollment/heartbeat on a loopback-published private interface. The separate operator-host agent alone reads the local Engine socket. `/nodes` projects timestamped inventory/credential health and canonical adult enrollment/rotation/revocation; it accepts public identity material only. Signed 30s time windows sample one instant to avoid millisecond rollover. Agent network retries retain sequence and never resume/change game state; credential failures stop. Native service ports, storage quotas, broker commands, physical leases/fences and provisioning remain unimplemented release gates.

### CL-F25-02/A planning boundary

[Provisioning runbook](../development/minecraft-provisioning.md) describes the implemented candidate template and effect-free dry-run. Canonical same-project environment plus node placement/provision authority is checked under current membership; child/viewer/cross-tenant and changed-permission denial applies. The digest is a short-lived preview identity, not an approval or reservation. Every actual execution gate remains closed; no job, image pull, EULA acceptance, Docker mutation or new world is dispatched by preview.

CL-F25-01/C implements the private local execution boundary under [ADR 0020](decisions/0020-node-execution-journal.md): signed reference-only jobs, fresh current permits, durable local intent/fence/stop/receipt and conservative uncertainty. No inventory protocol or public execution endpoint changes. Actual current-authority transport, broker, reservation/reconciliation and host qualification remain pending.
