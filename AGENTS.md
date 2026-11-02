# CraftLayer Engineering Instructions

These instructions apply to the entire repository and are shared by Codex and Claude Code. Direct user instructions take precedence. Read this file before changing code, plans, or deployments.

## Current state and source of truth

- Chapters 00–02 are implemented. Chapter 03 was authorized; inspect its actual completion state in `docs/delivery/status.md` before proceeding. Chapter 04 requires separate authorization unless explicitly superseded by the user.
- Read `docs/delivery/status.md`, `docs/README.md`, the relevant chapter, and architecture references before starting work.
- The original input is `docs/source/CraftLayer_Build_Blueprint.md`. Preserve it unchanged.
- The unified requirements inputs are `docs/CRAFTLAYER_UNIFIED_SPEC.md` and `docs/BUILD_PROMPT.md`.
- Implemented product invariants live in `docs/product/requirements.md`; detailed contracts live in `docs/architecture/`; implementation sequence lives in `docs/delivery/backlog.md`.
- Reconcile the unified specification into these derived documents rather than silently replacing implemented contracts. Update linked requirements, architecture, backlog, risk and decision records together; document material changes in ADRs.
- If documents conflict, apply the stricter safety invariant, record the conflict, and seek clarification when it affects scope or compatibility.

## Product scope and immediate priority

CraftLayer Core is one open-source, fully self-hostable platform with shared identity, RBAC, audit, dashboard, REST API, MCP, database, job processing and event contracts. It combines:

1. AI agent runtime, model routing, fleets, missions and pluggable environments.
2. Minecraft server discovery, read-only adoption, management, player access, backups, monitoring and Docker-based provisioning.
3. Secure management of multiple Docker hosts using dedicated node agents.
4. Optional future hosted services, separately implemented, without any Cloud dependency in Core.

**Immediate delivery goal:** a safe family Minecraft management platform on the existing Contabo VPS. Preserve all completed agent-orchestration work and do not rebuild completed chapters.

Delivery priorities:
1. Preserve and secure the existing Minecraft deployment.
2. Reuse existing auth, RBAC, audit and API foundations for a management dashboard.
3. Adopt and observe the existing Minecraft server read-only.
4. Verify Java/Bedrock player identity and enforce allowlists.
5. Provide scheduled backups with verified restoration.
6. Implement secure Docker host enrollment and node-agent communication.
7. Provision additional Minecraft servers on registered Docker hosts.
8. Add multi-server lifecycle controls, monitoring, REST and MCP.
9. Continue Minecraft AI agents and broader orchestration roadmap.

## Scope, autonomy and authorization

- Planning requests do not authorize implementation or production changes. For an unspecified new implementation request, follow the existing chapter authorization rules; do not reset to Chapter 00.
- Work through authorized tasks without unnecessary pauses for routine reversible local operations and tests.
- At chapter boundaries, provide review evidence and request authorization for the next chapter unless multiple chapters were explicitly authorized.
- The unified Minecraft priority is authorization to reconcile documentation and plan work, not blanket authorization to implement later chapters or operate production infrastructure.
- Never mark unexecuted checks as passed. Distinguish implemented, verified, deferred and blocked.
- Do not implement CraftLayer Cloud in Core. Chapter 11 belongs in a separately authorized repository.
- No paid inference, purchases, public deployments, package publication or outbound messages without separate authorization. Use local fakes for routine tests.
- Ongoing task-level commits and pushes to `origin main` are authorized as specified below. This does **not** authorize production deployment.

## Security and reliability invariants

1. Core works without Cloud, telemetry, internet entitlement checks or hosted identity.
2. Derive organization context from authenticated membership. Never trust a client-supplied or queued organization ID alone.
3. Enforce permissions in API handlers, domain services, workers, MCP tools and node operations; UI checks are supplementary.
4. Default to no paid inference fallback. Unknown or stale model prices are ineligible under free-only policy; instance constraints override lower-level configuration.
5. PostgreSQL owns durable state. Queues are at-least-once; use leases, fencing, reconciliation, idempotency and an outbox for reliable effects.
6. LLM output is untrusted. Agents cannot grant permissions, self-approve, select arbitrary tools or increase budgets.
7. Emergency stop is durable and outranks scheduling, retries, approvals and reconnects. Never clear it automatically on restart.
8. Child accounts use adult-approved presets and assigned worlds/agents only. No arbitrary prompts, terminal, coding, provider keys, infrastructure management, player attacks or external tools.
9. Never expose secrets in browser bundles, logs, prompts, queue payloads or artifacts. Never mount the Docker socket in API, web or general agent containers.
10. Never claim exactly-once physical effects or guaranteed free hosted inference capacity.
11. Treat Minecraft worlds and player data as irreplaceable. Never overwrite, recreate, migrate or delete existing worlds without explicit authorization and a verified recovery path.
12. Never expose RCON, Docker Engine, databases, node-management ports or internal admin APIs to the public internet.
13. Child accounts cannot provision/delete servers, change player access, restore backups, change network/security settings or manage credentials.
14. Treat compromise of a Docker-capable node agent as potential compromise of its host. Isolate it from unrelated workloads where possible; restrict accepted operations, images, mounts, networks and resources. Do not mistake an API wrapper for host isolation.

## Existing Contabo Minecraft server

- The existing server is a production family workload. Treat any details in historical documentation as unverified until inspected.
- Expected current deployment: Docker container `minecraft-java`, Compose at `/opt/minecraft-java/compose.yaml`, world/plugin data under `/opt/minecraft-java/data`, Paper with Geyser/Floodgate, Java TCP 25565 and Bedrock UDP 19132. Discover actual configuration; do not assume these paths or settings are current.
- First integration is **read-only**: inventory containers, mounts, networks, ports, versions, plugin settings, identity/allowlist behavior and backups.
- Before live writes: obtain explicit approval, verify a recoverable backup and restore procedure, define rollback, test access controls and confirm unrelated VPS services are unaffected.
- Adoption must register and monitor the existing container in place, not recreate it or relocate world data.
- Java and Bedrock account identities and Floodgate behavior must be tested against the pinned server/plugin versions. Never disable online authentication as a shortcut.

## Docker provisioning and secure node agent

Implement an adapter-based provisioning capability for registered existing Docker hosts first. New VPS purchase/provisioning via provider APIs is a later, separately authorized capability.

Reference template:

```yaml
name: Family Survival
target: contabo
server:
  type: paper
  java_heap_mb: 4096
  geyser: true
  floodgate: true
security:
  enforce_allowlist: true
  online_authentication: true
  public_rcon: false
backups:
  enabled: true
  schedule: daily
```

Requirements:
- Node registration with one-time, expiring enrollment; authenticated outbound-only control connection or equivalent private secure transport; credential rotation and revocation.
- Explicit, versioned and schema-validated node commands; no arbitrary shell, unrestricted RCON, Docker API passthrough or host-path selection by callers.
- Use an allowlist of approved, pinned images and vetted server/plugin versions; apply CPU/RAM/disk quotas, bounded networks, reserved ports, dedicated persistent volumes and controlled mount roots.
- Validate host capacity, storage, image/plugin compatibility, network exposure, port conflicts, resource quotas, world identity and tenant permissions before provisioning.
- Use durable deployment jobs with idempotency keys, operation state, progress, health checks, timeouts, retries, fencing and audit records.
- Ensure rollback removes only resources created by the failed operation, identified by ownership labels and immutable deployment IDs. Never delete pre-existing containers, volumes, worlds or backups.
- Server lifecycle: provision, start, stop, restart, inspect, update through approved migration path, backup, restore with approval, decommission with retention and explicit confirmation.
- Backups must be consistent, retained according to policy, protected against accidental deletion and periodically restore-tested into an isolated test instance.
- Use private RCON and narrowly scoped server-control adapters. Prefer typed actions over raw commands.
- Separate game connectivity from administrative connectivity. Default-deny firewall and network policies; expose only required Minecraft game ports.
- Only adult/admin roles may create or delete infrastructure. AI agents and MCP callers must never bypass approval or spending controls.

## API and MCP contracts

Use `/api/v1` with OpenAPI and Zod schemas. Planned resources include:

- `GET/POST /nodes`, `GET /nodes/{id}/capacity`, node enrollment/rotation/revocation.
- `GET/POST /servers`, `POST /servers/provision`, `GET /servers/{id}`, `GET /servers/{id}/deployment`.
- `POST /servers/{id}/start`, `/stop`, `/restart`, `/backup`; read-only status, metrics, logs, player and allowlist views.
- Explicitly authorized allowlist modifications, restore and decommission operations.
- `GET /operations/{id}` and scoped audit/event streams.

MCP tools should include `list_nodes`, `get_node_capacity`, `list_server_templates`, `list_servers`, `get_server_status`, `provision_minecraft_server`, `get_deployment_status`, `list_players`, `create_backup`, `list_backups`, `start_server`, `stop_server` and `restart_server`. High-risk tools require appropriate role checks and approval. MCP is not a privileged bypass around the API or domain services.

All mutations should return durable operation IDs, enforce idempotency, validate tenant/server scope, produce audit records and support reconciliation after crashes.

## Engineering conventions

- TypeScript strict mode, pnpm workspace, Zod contracts, Fastify API, Next.js web, Drizzle/PostgreSQL, BullMQ/Redis and Pino logs. Honor versions pinned by the existing project.
- Keep domain logic independent of web/API/queue frameworks and provider SDKs. Share JSON-safe contracts without leaking server-only dependencies into the browser.
- Use parameterized queries, scoped repositories, tenant-aware foreign keys, transaction-local RLS context and a separate migration role.
- Persist schema migrations and fixtures. No migration-time external network calls.
- Prefer deterministic clocks, seeded Minecraft fixtures, fake providers/adapters and fault injection.
- Avoid unrelated refactors or new frameworks without an ADR.
- Consult official documentation for pinned SDK and framework versions. Do not invent model availability or hardcode speculative prices.
- Docker Compose first, provider-agnostic and portable. Preserve existing services and volumes.

## Mandatory build-step publication

At the end of **every build step** (numbered task or smaller documented coherent checkpoint):

1. Run relevant available checks.
2. Update chapter/backlog/status and build log with stopping point, evidence and next action.
3. Commit only task-related changes.
4. Push to `origin main` as previously authorized, without force-push or secrets.
5. Verify local HEAD equals remote `main` and the working tree is clean.

A failed check or push must be reported and recorded honestly. Preserve unrelated user changes; inspect Git status before editing. Do not include `.env`, credentials, world data, database dumps or private artifacts in commits.

## Verification, review and handoff

- Inspect root `package.json` for actual scripts. Expected foundation checks include `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm docs:check` and Compose validation. Do not claim absent commands were run.
- For each task, record its ID, minimal implementation, test results and covered acceptance criteria.
- For each chapter, complete `docs/templates/chapter-review.md`, update risk register and status, report changed files and exact command results, and distinguish manual verification gaps.
- Use `docs/templates/agent-handoff.md` for agent/session handoffs.
- Minecraft release gates include: denied unauthenticated access; denied child provisioning/admin access; cross-tenant denial; blocked arbitrary node commands; blocked public RCON/Docker; correct Java/Bedrock allowlist enforcement; idempotent provisioning; port/capacity conflict rejection; crash reconciliation; non-destructive rollback; backup integrity and successful isolated restore; preservation of existing world data.
- Do not mark the family deployment production-ready until all applicable security, recovery and operational tests pass.

## First action for the next coding agent

Inspect the repository and delivery state. Reconcile `docs/CRAFTLAYER_UNIFIED_SPEC.md` and `docs/BUILD_PROMPT.md` with existing requirements, architecture, backlog and authorized chapters. Produce a gap analysis and the fastest safe, independently testable Minecraft management delivery track. Implement only within existing authorization, preserving completed work and all live worlds. Request authorization before crossing a chapter boundary or touching the production VPS.
