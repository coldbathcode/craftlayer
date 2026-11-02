# CraftLayer Unified Specification

**Version:** 0.4 | **Status:** Implementation specification | **Priority:** Family Minecraft security and management first

## 0. Relationship to original blueprint

This document **extends, not replaces**, `CraftLayer_Build_Blueprint.md` v0.2. The original vision remains: an open-source-first, self-hostable multi-agent harness with missions, fleets, provider routing, memory, Minecraft, coding and research adapters, and optional CraftLayer Cloud. The original chapter sequence is superseded by the delivery order in this document. The original technical choice of **TypeScript, pnpm, Fastify, Next.js, PostgreSQL + Drizzle, Redis/BullMQ, Mineflayer** remains canonical. Do not silently substitute Prisma. Keep the scheduler a simple durable state machine first.

**Non-negotiable product principle:** A self-hosted instance works without a Cloud account, subscription, telemetry service, or paid model. Minecraft management must work without any LLM.

## 1. Immediate objective and definition of done

The first deliverable is a safe family Minecraft server control panel on an existing Contabo Ubuntu VPS, managing an existing `minecraft-java` Docker container and its persisted world at `/opt/minecraft-java/data`. The game server may currently be stopped. **Never start it, delete it, migrate its world, or modify its configuration without explicit operator approval.** The operator should be able to enroll the existing server, securely approve/revoke the children's Minecraft accounts, see online players, initiate backups, inspect audit logs and stop/restart the server. No bots or LLM setup should block this milestone.

Acceptance: unapproved Java and Bedrock players cannot join; approved accounts can join; revocation is enforced; API calls without authorization fail; child users cannot administer the server; RCON remains non-public; a backup is restored successfully in a disposable test environment; existing world bytes are preserved; all management mutations are audited.

## 2. Unified architecture

```text
Browser (Parent / Child)    REST clients     Remote MCP clients
          \                    |                 /
           Authenticated HTTPS gateway / private access
                           |
               CraftLayer API + policy engine
               Auth / RBAC / Audit / Events
                  /                 \
        Environment Control       Agent Orchestrator
        server registry           missions / fleets / DAG
        player access             memory / budgets / tools
        backup / lifecycle        provider model router
                  \                 /
             Durable jobs + PostgreSQL + Redis
                         |
             Local / outbound Node Agent
                   /             \
       RCON / Paper adapter    Mineflayer agent workers
                  \             /
              Minecraft Java/Paper + Geyser/Floodgate
```

Minecraft server administration and autonomous bot play are **different trust domains**. Mineflayer bots receive in-game capabilities only. They must never inherit RCON, Docker, API owner, or host privileges. The same RBAC and audit infrastructure governs dashboard, REST, MCP, workers and agents. Future adapters may target Pterodactyl/Pelican, coding sandboxes and research tools. CraftLayer Cloud is a separate optional commercial service.

## 3. Stack and repository

- Monorepo: pnpm, TypeScript strict mode; Go node agent only if multi-host complexity warrants it. For the immediate local single-host release, a small TypeScript adapter service is preferable to unnecessary infrastructure.
- UI: Next.js, Tailwind, shadcn/ui, accessible mobile-first parent and child modes.
- API: Fastify, Zod, OpenAPI 3.1, generated typed clients, Pino.
- Data: PostgreSQL + Drizzle migrations, Redis + BullMQ.
- Auth: self-hosted local accounts with Argon2id, secure sessions, recovery process and optional OIDC; require MFA for remotely accessible privileged accounts, using OIDC where practical.
- MCP: official TypeScript MCP SDK, Streamable HTTP with OAuth-compatible protection for remote clients; optionally local stdio connector for trusted local tooling.
- Agent harness: Mineflayer, deterministic action tools, task DAG, provider routing and bounded memory.
- Models: OpenRouter, Ollama, Gemini, OpenAI, Anthropic, configurable OpenAI-compatible endpoints; preserve original free-only fail-closed budget policies.
- Deployment: Docker Compose on Ubuntu 24.04, provider-neutral, separate Compose projects and persistent volumes.

```text
craftlayer/
  apps/{web,api,worker,mcp}/
  packages/{contracts,auth,rbac,audit,db,core,orchestrator,model-router,provider-adapters}/
  packages/{environment-minecraft,environment-coding,environment-research}/
  services/{minecraft-control,minecraft-node}/
  runtimes/{agent-harness,minecraft-bot}/
  adapters/{minecraft-rcon,minecraft-paper,pterodactyl,pelican}/
  examples/{family-minecraft,minecraft-village,coding-team,research-team}/
  infra/{compose,reverse-proxy,backup}/
  docs/{chapters,architecture,security,operations}/
  tests/{integration,e2e,security}/
  README.md
  .env.example
  compose.yaml
```

## 4. Minecraft family-server hardening requirements

### 4.1 Preserve and inventory existing deployment

Before any change, inspect `docker inspect minecraft-java`, existing Compose file, `/data/server.properties`, Geyser/Floodgate configuration, Docker port publishing, UFW/DOCKER-USER and Contabo firewall, volume ownership, plugins, operator list, whitelist, RCON settings and available disk. Redact credentials in reports. Create a timestamped, verified pre-change backup, including world, config and plugin state, before modifying anything. Never use `docker compose down -v`, prune volumes, or overwrite world directories. Pin tested image/plugin versions or digests, not `latest`, in production. Verify Minecraft/Paper/Geyser/Floodgate version compatibility before deployment.

### 4.2 Player identity and allowlisting

- Java: `online-mode=true`, Microsoft/Mojang authentication and authoritative UUID-based allowlist.
- Bedrock: Geyser + Floodgate integration with identity mapping and Floodgate-aware allowlisting; inspect the actual installed plugin and version before choosing commands. Do not assume a gamertag string is an immutable identifier or that Java's standard whitelist automatically covers Floodgate.
- Minecraft does not provide a universal extra server password. Use official account authentication + strict allowlist. Optional extra authentication plugins are **not** a default recommendation; evaluate compatibility and avoid storing child passwords.
- `white-list=true`, `enforce-whitelist=true`; deny unknown players. Never temporarily disable the whitelist to onboard an account. For first-time Bedrock identities, provide a documented safe resolution/enrollment flow that does not create a public join window.
- Owner/operator privileges only for explicitly selected adult accounts; children receive no operator permissions. Default `pvp=false`, `enable-command-block=false`, conservative gameplay rules. Never equate a web account with a Minecraft account without explicit binding.
- Player access desired state is stored in the database; the node adapter applies it and verifies actual state. Show `pending`, `applied`, `failed`, `drifted` rather than assuming success.
- Revoke access and optionally kick online player as two explicit operations; bans and temporary access have separate workflows.

### 4.3 Network and host boundaries

- Game traffic only: Java TCP 25565; Bedrock TCP/UDP 19132 **only if required by the deployed Geyser transport**. Verify actual transport and firewall rules.
- Never publish RCON TCP 25575, database, Redis, Docker API or agent management ports to public interfaces.
- RCON credentials generated securely, file-mounted, rotated, redacted, and limited to the local management adapter. Note that RCON is not TLS by itself: use a private network or protected tunnel, never traverse the public internet unprotected.
- Management UI/API/MCP: prefer Tailscale or Cloudflare Access for the family deployment, with HTTPS, authenticated identity, CSRF protection and strong sessions. An external reverse proxy must enforce authentication on **all** management paths, including MCP, event streams and WebSockets.
- Docker-published ports may bypass ordinary UFW policies. Verify effective packet filtering and Contabo edge rules, without accidentally blocking SSH or other VPS services.
- Use dedicated unprivileged containers, no-new-privileges, least-capability mounts, resource limits, log rotation and image scans. Avoid mounting `/var/run/docker.sock` into a network-facing app. If lifecycle control is needed, use a minimal local broker with explicit container allowlist and fixed verbs, or a rootless, constrained agent. No arbitrary container IDs or host commands from API callers.
- Keep Minecraft plugins trusted and updated; restrict plugin installation to adults and audited workflows.

### 4.4 Backups and disaster recovery

- Scheduled Minecraft-consistent world backups via save coordination; verify implementation against actual RCON behavior and image capabilities.
- Daily backups, 14-day retention minimum; weekly off-host backups; encryption in transit and at rest; separate secrets and world archives.
- Backup includes world, allowlist, config, Geyser/Floodgate identity data and relevant plugins. Do not include plaintext RCON passwords in downloadable archives.
- Restore requires adult/admin permission, explicit confirmation, pre-restore snapshot and stopped/quiesced game state. Test restores to a disposable server before trusting backups.
- Detect failures and disk exhaustion; expose backup health prominently on dashboard.

## 5. Parent and child UX

**Parent dashboard:** server status and uptime; Java/Bedrock connection instructions; online players; approved identities; add/revoke/temporary access; kick/ban with confirmation; world settings; backups and restore; health metrics and logs; server start/stop/restart; role assignments; audit; API/MCP credentials; agent and mission controls. Phone-friendly layout.

**Child mode:** approved worlds, safe agent presets, team selection, mission progress, friendly bot cards, clear Stop All button. No credentials, model provider keys, payments, terminal, arbitrary prompts that grant tools, bans, player moderation, server lifecycle or backup restore. Parent-controlled mission allowlists, world boundaries, combat and spend policies. Default no player-targeting or griefing behavior.

**Onboarding:** setup owner -> verify host and world backup -> inspect security -> bind server -> test RCON privately -> configure allowlist -> enroll identities -> test access denial -> enable backup policy -> optional agents. Security checks must block a 'ready for children' badge if critical requirements fail.

## 6. API design

Versioned base `/api/v1`; OpenAPI 3.1; cursor pagination; Zod validation; idempotency keys for writes; asynchronous operations with status, attempts, failure reason, correlation ID and actor. API must not expose unrestricted `executeCommand` or arbitrary file editing.

| Method | Path | Permission |
|---|---|---|
| GET | `/servers` | `server:read` |
| POST | `/servers` | `server:create` |
| GET | `/servers/{id}/status` | `server:read` |
| POST | `/servers/{id}/start` | `server:lifecycle` |
| POST | `/servers/{id}/stop` | `server:lifecycle` |
| POST | `/servers/{id}/restart` | `server:lifecycle` |
| GET | `/servers/{id}/players` | `player:read` |
| POST | `/servers/{id}/allowlist` | `player:allow` |
| DELETE | `/servers/{id}/allowlist/{identityId}` | `player:revoke` |
| POST | `/servers/{id}/players/{identityId}/kick` | `player:kick` |
| GET | `/servers/{id}/world` | `world:read` |
| PATCH | `/servers/{id}/world/rules` | `world:modify` |
| GET | `/servers/{id}/backups` | `backup:read` |
| POST | `/servers/{id}/backups` | `backup:create` |
| POST | `/servers/{id}/backups/{backupId}/restore` | `backup:restore` |
| GET | `/operations/{id}` | `operation:read` |
| GET | `/audit-events` | `audit:read` |
| GET/POST | `/agents`, `/groups`, `/missions` | corresponding scoped permissions |
| POST | `/missions/{id}/pause` | `mission:control` |
| POST | `/emergency-stop` | `emergency:stop` |
| GET | `/events/stream` | scoped read permissions |

Example allowlist request:

```json
{"edition":"bedrock","gamertag":"ExampleGamer","serverId":"srv_123","reason":"Family approved","expiresAt":null}
```

Return HTTP 202 with `{ "operationId": "op_123", "status": "queued" }`; identity resolution and application happen asynchronously. If a gamertag cannot be safely resolved, return a pending verification state, never claim it was applied.

## 7. MCP contract

MCP is a **separately secured interface to the same application services**, not a privileged RCON tunnel. Use Streamable HTTP for remote clients with audience-bound OAuth access tokens and appropriate discovery/authorization behavior; local stdio integration may be offered for trusted tooling. Never rely on MCP client prompts as authorization.

Read tools: `list_servers`, `get_server_status`, `list_players`, `get_world_info`, `get_server_metrics`, `list_backups`, `get_operation_status`, `list_missions`, `get_mission_status`.

Write tools: `allow_player`, `revoke_player`, `kick_player`, `set_world_time`, `set_weather`, `create_backup`, `restart_server`, `create_mission`, `pause_mission`, `stop_agents`.

High-risk tools: `restore_backup`, `stop_server`, `ban_player`, `change_access_policy`, `rotate_credentials`; explicit adult approval and narrow scope. Every call: authenticated principal -> tenant/project/server scope -> permission check -> schema validation -> policy check -> job -> audit -> verified result. No generic RCON/shell/Docker tools.

## 8. Roles, tenancy and data model

Hierarchy: Instance -> Organization -> Project -> Environment/Server -> Agent/Player/Mission. Principals: human, service account, agent. Default-deny permissions, no implicit inheritance of Minecraft OP privileges. Existing original roles remain: Instance Owner, Org Admin, Operator, Builder, Viewer, Child. Add Server Operator, Player Manager, Automation Agent as scoped role templates. Permissions include `server:read`, `server:lifecycle`, `player:allow`, `player:revoke`, `player:kick`, `backup:create`, `backup:restore`, `agent:assign`, `mission:execute`, `provider:manage`, `audit:read` and `emergency:stop`. Child role explicitly denies administration and spending.

Tables: `organizations`, `users`, `sessions`, `memberships`, `projects`, `roles`, `role_bindings`, `nodes`, `servers`, `server_adapters`, `server_configurations`, `players`, `player_identities`, `server_player_access`, `player_groups`, `operations`, `operation_attempts`, `scheduled_jobs`, `backup_policies`, `backups`, `service_accounts`, `api_credentials`, `oauth_clients`, `audit_events`, `providers`, `models`, `agents`, `groups`, `missions`, `tasks`, `task_dependencies`, `agent_memories`, `budgets`, `approvals`.

Use stable Minecraft identity IDs with edition and verification provenance; names are display attributes. Every query and background job validates org and project scope. Audit events include actor, action, target, request ID, before/after redacted metadata, outcome, source, timestamp and chained integrity metadata if enabled. Database append-only permissions plus optional external export; never claim the database is tamper-proof.

## 9. Agent orchestration from original blueprint

Preserve original CraftLayer Core capabilities:

- Mission lifecycle: draft -> queued -> running -> paused/blocked -> succeeded/failed/cancelled; task DAGs, worker leases, retries, idempotency, heartbeat and crash recovery.
- Fleet/group orchestration, commander/planner, scouts, miners, lumberjacks, couriers, builders, guards, quartermasters; bounded shared event blackboard and world memory.
- Mineflayer movement, pathfinding, inventory, mining, crafting, construction from deterministic blueprints, exploration and combat against hostile mobs only when allowed. Explicitly prohibit attacking human players by default.
- Model router: Ollama, OpenRouter, Gemini, OpenAI, Anthropic, generic OpenAI-compatible; free-only policy with paid fallback disabled by default, verify prices at request time, fail closed on unknown prices, enforce per-mission/agent/org token and spend budgets.
- Emergency stop at instance/org/world/mission level. Child-facing Stop All must stop bot actions promptly and remain functional during model outages.
- Coding agent example: isolated Git workspaces, allowlisted commands, reviewed diffs, approval before deployment; research agent example: cited public-source reports and untrusted-content defenses.
- Agents use restricted capability tokens scoped to world and mission, never management credentials.

## 10. Multi-server and adapters

Server registry supports many worlds across local and remote nodes. Initial RCON adapter manages existing standalone Paper server. Add Paper plugin bridge for structured metrics and Floodgate identity APIs where RCON is insufficient. Add Pterodactyl and Pelican adapters later, without requiring migration. Agent-node enrollment uses one-time short-lived token followed by mutually authenticated outbound connection; per-node server allowlist; heartbeat and reconnection. Avoid publicly exposed node management ports.

Adapter contracts:

```ts
interface MinecraftControlAdapter {
  capabilities(): Promise<string[]>;
  status(serverId: string): Promise<ServerStatus>;
  listPlayers(serverId: string): Promise<PlayerSession[]>;
  reconcileAccess(serverId: string, desired: AccessRule[]): Promise<ReconcileResult>;
  perform(serverId: string, operation: TypedMinecraftOperation): Promise<OperationResult>;
}
interface EnvironmentAdapter {
  startAgent(config: AgentConfig): Promise<AgentHandle>;
  observe(agent: AgentHandle): Promise<Observation>;
  execute(agent: AgentHandle, task: Task): Promise<TaskResult>;
  stopAgent(agent: AgentHandle): Promise<void>;
}
interface ModelProvider {
  listModels(): Promise<ModelDescriptor[]>;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
}
```

## 11. Deployment and operations

Separate Compose projects for existing Minecraft runtime and CraftLayer control plane. Preserve existing `/opt/minecraft-java/compose.yaml` and `data` bind mount. First deploy CraftLayer services with no access to game world files and no Docker socket; connect through local private RCON after verification. For lifecycle control, introduce constrained node agent in a later approved step. Web/API/MCP accessible only through authenticated TLS proxy/private network. Database, Redis and RCON are never published. Healthchecks, resource limits, secret files, migration backups, log rotation and pinned image digests required. Support Ubuntu 24.04, Mac and generic VPS. No vendor-specific dependency.

Deployment deliverables: `infra/compose/compose.yaml`, `.env.example` (no real secrets), `scripts/preflight.sh`, `scripts/backup.sh`, `scripts/restore-test.sh`, `scripts/security-check.sh`, documented install/upgrade/rollback. Preflight must warn rather than modify unrelated Docker workloads. Never auto-enable firewall or modify SSH rules. Document the difference between game public ports and private management plane. Cloudflare Tunnel/Access or Tailscale are optional deployment recipes.

## 12. Security threat model and required tests

Threats: unknown Minecraft players, malicious Bedrock identity claims, stolen parent sessions, compromised child accounts, forged MCP tokens, prompt-injected agents, compromised Minecraft plugins, RCON exposure, Docker breakout, tenant-crossing queries, destructive restore, ransomware and lost world data, supply-chain compromise, credential leaks, cost runaway.

Required controls: deny-by-default policy, strong sessions/MFA for privileged users, hashed scoped credentials and rotation, secret redaction, rate limits, CSRF and CORS allowlists, per-tool MCP OAuth audience and scopes, explicit high-risk approval, input allowlisting, private RCON, no generic command execution, no Docker socket in API, backups off-host, restore testing, audit trails, dependency/image scanning and pinned versions.

Test matrix:
1. Unapproved Java player denied; approved player admitted.
2. Unapproved Bedrock player denied; approved Floodgate identity admitted.
3. Identity rename does not silently transfer permissions.
4. Child cannot change allowlist, backups, provider keys or server lifecycle.
5. Viewer and read-only MCP client cannot mutate.
6. API key for server A cannot operate on server B or another org.
7. Forged/expired OAuth token rejected; MCP tools require authorization.
8. RCON and Docker API unreachable from public network.
9. Backup creation and clean-room restore verified with checksums.
10. Worker crash/retry does not duplicate destructive operations.
11. Stopped Minecraft container does not get silently started during installation.
12. Existing world and unrelated Docker containers unchanged after installation.
13. Agent prompt injection cannot acquire administrative privileges.
14. Free-only model policy never incurs paid fallback.
15. Emergency stop works with LLM provider unavailable.

## 13. Revised delivery order: server management ASAP

**Phase F0, preflight and secure baseline:** inventory existing server, config, versions, ports, identity providers and Docker permissions; snapshot and verify backup; identify critical exposure; produce a non-destructive remediation plan. No unapproved changes. Deliver security checklist and reversible steps.

**Phase F1, minimum secure control plane:** Compose for API, web, PostgreSQL, Redis, worker; bootstrap owner; secure local auth, session controls, scoped RBAC, audit; register existing Minecraft server via private RCON; status, online players, basic dashboard; TLS/private access recipe. No model provider dependency.

**Phase F2, family access and backups:** Java/Bedrock identity enrollment, enforced allowlist, add/revoke, online kick, actual-state reconciliation, verified backups and restore test, parent-friendly UI. This is the **family-ready release gate**.

**Phase F3, server operations:** safe lifecycle broker, metrics, log viewing, multi-server registry, job tracking, operation approvals and notifications.

**Phase A1, original agent core:** model routing, free-only policies, agent runtime, one Mineflayer bot, bounded missions, Kid Mode and Stop All.

**Phase A2, agent armies:** multiple bots, planner, shared memory, resource gathering, deterministic building, exploration, defense and coordination.

**Phase A3, integrations:** secured MCP, complete REST/OpenAPI SDK, remote nodes, Pterodactyl/Pelican adapters, coding/research examples.

**Phase C, optional Cloud:** hosted management, tenant isolation, BYOK, billing hooks and managed workers only after Core is secure and stable.

Each phase requires implemented code, tests, docs, threat review and a checkpoint. **Do not delay F0-F2 for agent features.**

## 14. Definition of success

**Family-ready:** a parent logs into a private dashboard, sees the existing Contabo server, approves a child's Java or Bedrock account, verifies only approved accounts can connect, manages backups and access safely, and sees a complete audit trail. The existing world survives untouched.

**Agent-ready:** two or three approved Mineflayer agents collaborate on a bounded build in a test world using an allowed free/local model, with progress in the dashboard and a reliable Stop All control.

**Platform-ready:** multiple servers and environments, REST and MCP under consistent RBAC, self-hosted portability, tested backup/restore and optional commercial Cloud without Core dependency.

## 15. Open source and business model

Keep Apache-2.0 as preferred license pending dependency review. Fully functional open-source Core, no artificial local agent count limit. Future Cloud charges for hosted operations, remote fleet convenience, managed updates, backups and support. BYOK first; do not assume provider token resale rights. Branding and domains require independent availability/trademark verification.


## 16. Docker Minecraft server provisioning (new, priority F2.5)

### 16.1 Purpose and scope
CraftLayer can **adopt** existing Minecraft servers without modifying their containers, or **provision** new Minecraft servers onto an enrolled Docker host. These are different workflows and must never be conflated. First target: the existing Contabo Ubuntu VPS. Later targets: other VPSs, LAN machines, and optional provider-API-created VPSs. Provisioning an already available Docker host is in scope now; purchasing/provisioning a VPS via cloud provider APIs is a later, separately approved adapter.

The Minecraft deployment feature is an environment-control capability, not dependent on LLMs, missions, or agent runtime. It must be available in the parent dashboard, REST API and policy-controlled MCP interface. Docker orchestration must not overwrite unrelated workloads.

### 16.2 Example template: Family Survival

```yaml
apiVersion: craftlayer.dev/v1alpha1
kind: MinecraftServer
metadata:
  name: family-survival
  displayName: Family Survival
spec:
  targetNode: contabo
  managementMode: provision # adopt is separate
  server:
    type: PAPER
    version: tested-pinned-version # resolve and record an approved immutable version
    javaMemory: 4GiB
    maxPlayers: 10
    onlineMode: true
    pvp: false
    difficulty: easy
    eulaAccepted: false # explicit adult acknowledgement required before deploy
  crossplay:
    enabled: true
    geyser: true
    floodgate: true
    # Validate plugin compatibility and installed transport configuration.
  access:
    enforceAllowlist: true
    defaultDeny: true
    publicManagementPorts: false
    operatorIds: []
  backups:
    enabled: true
    schedule: '0 3 * * *'
    timezone: Europe/London
    retentionDays: 14
    requireVerifiedRestoreTest: true
  resources:
    containerMemoryLimit: 6GiB # allow JVM overhead beyond 4GiB heap
    cpuLimit: 4 # validate node capacity; adjust if needed
  storage:
    mode: managed-volume
    deleteOnServerRemoval: false
  network:
    javaPort: auto # default preference 25565 if unallocated
    bedrockUdpPort: auto # prefer 19132 if unallocated
    bedrockTcpPort: auto # only if installed transport requires it
```

The example is a **declarative desired-state template, not a deployable Compose file**. `eulaAccepted` must be set only following explicit adult acceptance. Paper/Geyser/Floodgate versions, Minecraft protocol compatibility, transport, exposed ports, RCON environment settings and backup image behavior must be validated against the versions actually deployed. No fixed public port may be assigned without checking for collisions. A 4 GiB Java heap is not the same as a 4 GiB container limit. Backups need an off-host option, storage headroom checks and a tested restore.

### 16.3 Node enrollment and secure architecture

- Node registry: stable node ID, organization/project, labels, supported architecture, Docker/OS versions, resource capacity, free ports, agent version, health, last heartbeat and capability inventory.
- Install a minimal **CraftLayer Node Agent** through a documented, one-time host bootstrap. Initial host bootstrap requires an administrator and explicit trust approval; it must not run unattended shell commands fetched from the internet.
- Agent establishes an **outbound mutually authenticated encrypted connection** to the control plane, supports credential rotation/revocation, enrollment token expiry and certificate pinning or verified CA trust. No public Docker daemon, RCON or agent listener.
- The Docker API is effectively root-equivalent. The agent is a privileged host component and must be treated as such. Prefer a dedicated Docker host or rootless Docker where compatible; use a hardened local broker with a strict allowlist of operations, validated images, mounts, networks, limits and labels. Never mount the raw Docker socket into the dashboard, API, MCP service or LLM workers. A socket proxy alone is not a sufficient isolation boundary.
- Enforce per-node placement policies, namespace/resource ownership labels, image digest allowlists, no privileged containers, no host PID/network, no host filesystem mounts outside an approved dedicated data root, `no-new-privileges`, drop Linux capabilities where compatible, resource quotas, log size caps and disk quotas/alerts.
- Node agent must accept **signed, expiring, uniquely identified jobs**, validate the requested operation and target server locally, enforce idempotency, and report actual state. Prevent cross-tenant resource access even if a job payload is forged or replayed.
- Use encrypted secret delivery and node-local secret storage with restrictive permissions. Never put RCON passwords in audit logs, Compose YAML committed to Git, command arguments or browser responses.
- On same-host deployments, use a private network for control traffic; remote nodes connect outbound over mTLS. Game ports alone may be exposed publicly, and firewall changes require explicit operator review.
- For adopted servers, start read-only. Adoption requires explicit mapping to existing container, world directory, RCON endpoint, game ports and backup policy. **Never automatically take ownership of or mutate an adopted container.**

### 16.4 Provisioning workflow and state machine

States: `requested -> validating -> awaiting_approval -> reserving -> pulling -> creating_storage -> configuring -> starting -> verifying -> ready`, with `failed`, `rolling_back`, `rolled_back`, `degraded`, `stopping`, `stopped`, `deleting` and `deleted` as appropriate. Persist state transitions and job attempts; every mutation is audited.

1. Authenticate the human or machine principal; require `servers.provision` on the target project and `nodes.deploy` on the target node. For MCP or AI-initiated deployment, require explicit human approval before execution.
2. Validate template schema, EULA acknowledgement, requested server type, plugin compatibility, identity and allowlist strategy, approved image digests and secure defaults.
3. Validate target node health, Docker availability, capacity headroom (CPU/RAM/disk), world volume allocation, backups, network routes, available ports and quotas. Check for collisions with **all** host workloads, not just CraftLayer containers.
4. Generate a deployment plan including exact image digest, storage paths, reserved ports, security profile and any firewall changes. Show a dry-run diff and require confirmation for production host changes.
5. Acquire a transactionally managed port/resource reservation and an idempotency lock. Create uniquely labelled, managed storage and container resources only; do not touch unlabeled or foreign resources.
6. Pull pinned images, materialize secrets, create storage with safe permissions, generate Paper configuration, install verified compatible plugins, and set strict allowlist/default-deny **before** opening game access.
7. Start the container; verify Docker health, Minecraft readiness, Java online authentication, configured Geyser/Floodgate mode, allowlist enforcement, RCON privacy and backup scheduler. Distinguish process-running from game-ready.
8. Publish the server to the registry only after successful verification. Record actual image, versions, ports, resource usage and deployment manifest. Report `ready` only on verified readiness.
9. Reconcile desired and actual state on agent restart and control-plane reconnect, with drift alerts rather than automatic destructive correction.

### 16.5 Lifecycle and preservation rules

- `start`, `stop`, `restart`: asynchronous, scoped operations with progress, timeouts, idempotency and audit. Respect operator-initiated stops; do not unexpectedly restart a stopped family server.
- `update`: take and verify a backup, check version compatibility, perform staged update, run smoke tests, allow explicit rollback to previous pinned image/config. Never silently upgrade the world to a version that cannot be rolled back.
- `backup`: consistent Minecraft save coordination, retention, checksums, backup metadata, encrypted optional off-host copy and a disposable restore test.
- `restore`: adult/admin only, high-risk approval, pre-restore backup, world lock and server stop, verified archive and path traversal defense, restore into staging then atomic switch where supported. Record outcome.
- `delete`: require typed confirmation, separate container removal from data deletion, **retain volumes and backups by default**. No implicit prune or Docker-wide cleanup. Destructive world deletion is a separate two-step action requiring owner approval and a recovery window.
- `adopt`: never delete, recreate, rename or rewrite the existing `minecraft-java` container or `/opt/minecraft-java/data` automatically. An existing world must be preserved byte-for-byte unless the operator approves a specific change after a verified backup.
- `rollback`: clean up **only** newly created, labelled resources from the failed deployment, release port reservations and revoke ephemeral secrets; retain world storage and diagnostic logs. Rollback must not touch unrelated Docker containers or volumes. A world data migration is not rolled back simply by reverting an image.

### 16.6 REST API additions

All endpoints are under `/api/v1`, use OpenAPI 3.1 and Zod validation, support correlation IDs, audit, server-scoped RBAC and appropriate idempotency keys. Long-running actions return `202 Accepted` and an operation ID. Never return Docker socket credentials or RCON secrets.

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/nodes` | `nodes.read` |
| POST | `/nodes/enrollments` | `nodes.enroll` |
| GET | `/nodes/{nodeId}/capacity` | `nodes.read` |
| GET | `/server-templates` | `servers.read` |
| POST | `/servers/provision/plan` | `servers.provision` |
| POST | `/servers/provision` | `servers.provision` + `nodes.deploy` |
| POST | `/servers/adopt/plan` | `servers.adopt` |
| POST | `/servers/adopt` | `servers.adopt` |
| GET | `/servers/{serverId}/deployment` | `servers.read` |
| POST | `/servers/{serverId}/start` | `servers.lifecycle` |
| POST | `/servers/{serverId}/stop` | `servers.lifecycle` |
| POST | `/servers/{serverId}/restart` | `servers.lifecycle` |
| POST | `/servers/{serverId}/update/plan` | `servers.update` |
| POST | `/servers/{serverId}/update` | `servers.update` |
| POST | `/servers/{serverId}/backups` | `backups.create` |
| POST | `/servers/{serverId}/restores` | `backups.restore` + approval |
| DELETE | `/servers/{serverId}` | `servers.delete` + approval |
| GET | `/operations/{operationId}` | `operations.read` |

`DELETE /servers/{id}` removes the managed runtime registration/container only by default; it **must not** remove world data or backups. A separate high-risk API with explicit confirmation is required for permanent data erasure.

### 16.7 MCP tools and restrictions

MCP uses authenticated Streamable HTTP with OAuth audience/resource validation, tool-level policy checks, tenant and node scoping, rate limits, audit and human approval for mutation where applicable.

Read tools: `list_nodes`, `get_node_capacity`, `list_server_templates`, `get_deployment_plan`, `get_deployment_status`, `list_minecraft_servers`.

Mutation tools: `provision_minecraft_server`, `adopt_minecraft_server`, `start_minecraft_server`, `stop_minecraft_server`, `restart_minecraft_server`, `create_server_backup`.

High-risk operations (`delete`, `restore`, host firewall changes, paid VPS creation) must **not** be exposed as automatically executable tools by default. No arbitrary Docker, shell, SSH, RCON, host mount or image pull tool. Agent/child principals cannot self-approve operations or increase their own permissions. MCP clients must not bypass the REST policy engine.

### 16.8 Dashboard experience

Create Server wizard: choose existing Docker node -> server template -> name -> Java heap/container resources -> Java/Bedrock crossplay -> player allowlist -> backups -> validate and preview -> adult confirmation -> progress and readiness. Show available capacity, actual allocated ports, secure defaults, deployment logs (redacted), backup health and rollback status. Add an **Adopt Existing Server** flow that is clearly separate from **Create New Server**.

The sample wizard defaults to `Family Survival`, node `contabo`, Paper, 4 GiB Java heap, enforced allowlist and daily backups. Show a security warning and require privileged confirmation if an operator tries to disable the allowlist. Child role cannot create servers, change networking, access secrets or change access policy.

### 16.9 Acceptance tests and release gate

Automate tests with disposable Docker hosts/containers and a mock Docker engine. Run production-host checks read-only until explicit approval.

1. Provision `Family Survival` on a clean enrolled test node with Paper, 4 GiB Java heap, strict allowlist and daily backup schedule; report actual healthy state.
2. Deny a non-admin or child attempting to provision, manage ports or disable the allowlist; confirm audit entry.
3. Deny unauthenticated REST and MCP requests; reject expired/replayed node jobs and cross-tenant targets.
4. Confirm RCON, Docker API, PostgreSQL, Redis and node management ports are not exposed publicly.
5. Detect and reject insufficient memory/disk, unsupported plugin combinations, invalid EULA acceptance and occupied Java/Bedrock ports **without creating resources**.
6. Simulate image pull failure, failed startup, plugin incompatibility and readiness timeout; verify rollback removes only new labelled resources, retains storage, releases reservations and records failure.
7. Re-run a provision request with the same idempotency key; exactly one server is created.
8. Restart the control plane and node agent mid-deployment; verify reconciliation resumes without duplicate containers or port collisions.
9. Confirm daily backup job is scheduled, produces a consistent checksum-verified archive and restores into a disposable test server.
10. Confirm Java and Bedrock allowlist behavior with actual compatible clients; unapproved accounts are rejected, approved accounts can join and revocation is enforced.
11. Adopt the existing `minecraft-java` server in read-only mode and confirm its container ID, mount paths, world checksums and Docker state are unchanged.
12. Provision and delete a separate test server on the same host; confirm existing `minecraft-java`, `/opt/minecraft-java/data` and unrelated Docker services are untouched.
13. Stop a managed server, reboot/restart agent, confirm it remains stopped until explicitly started.
14. Verify lifecycle, backup and deployment operations are audited with actor, server, node, request ID, before/after state and outcome, without secrets.
15. Attempt unauthorized MCP `provision_minecraft_server` and confirm denied; require human approval for authorized agent-initiated provisioning.
16. Verify container CPU/memory limits, restricted mounts, pinned images, EULA audit and off-host backup option.

**Provisioning-ready gate:** No release until tests 1-16 pass on a disposable environment, and the Contabo adoption preflight plus explicit operator approval has been completed. The family-ready gate from Section 1 remains mandatory.

### 16.10 Delivery priority change

Add **Phase F2.5: Secure Docker provisioning** immediately after F2 (family allowlist + backup readiness), before F3 multi-server operations and before all AI agent phases. Deliver node enrollment, secure local Docker broker, templates, dry-run, provision, status, rollback, daily backups and UI. Do not postpone family safety for provisioning. VPS-provider-API creation is later and always requires explicit cost approval.
