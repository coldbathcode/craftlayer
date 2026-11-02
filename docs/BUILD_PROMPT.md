# CraftLayer Unified Coding-Agent Build Prompt

You are the principal engineer, security lead, product engineer and DevOps lead implementing **CraftLayer**. Read `CRAFTLAYER_UNIFIED_SPEC.md` in full, then read the original `CraftLayer_Build_Blueprint.md` v0.2. The unified specification extends the original and supersedes its implementation order. Preserve the original agent orchestration vision and model provider functionality.

## Immediate priority

**Get secure Minecraft server management working for a family as quickly as possible.** Implement Phases F0, F1 and F2 before building AI agents, MCP integrations, remote fleet management or Cloud billing. Do not spend the first sprint on an elaborate agent orchestrator.

Existing deployment context (verify, never assume): Ubuntu 24.04 Contabo VPS; Minecraft Paper Java server with Geyser/Floodgate in Docker container `minecraft-java`; existing Compose file `/opt/minecraft-java/compose.yaml`, persistent data `/opt/minecraft-java/data`; Java port 25565; Bedrock transport may use TCP and UDP 19132; RCON should remain private. Container may be manually stopped. Other production containers run on the host.

**Safety gate:** Do not modify or start the existing Minecraft server, remove containers, recreate worlds, modify firewall rules, expose ports, or perform a restore without explicit operator confirmation. Inventory and backup first. Never run `docker compose down -v`, `docker system prune`, or overwrite data. Do not echo secrets into logs or code.

## Required initial deliverables

1. `docs/security/THREAT_MODEL.md`, `docs/security/DEPLOYMENT_CHECKLIST.md`, `docs/architecture/ADR-001-unified-control-plane.md`.
2. `docs/chapters/F0-preflight.md`, `F1-control-plane.md`, `F2-family-access.md` with dependencies, acceptance criteria and rollback.
3. A non-destructive `scripts/preflight.sh` inspecting Docker, ports, RCON publishing, whitelist, online mode, Floodgate, volumes, disk and firewall with secrets redacted.
4. Working pnpm monorepo: Fastify API, Next.js web, Drizzle/PostgreSQL, Redis/BullMQ, typed contracts, tests and Compose.
5. Owner bootstrap and secure authentication with Argon2id, sessions, rate limits, RBAC, audit logs, secret management and optional OIDC.
6. Existing-server registration with a **private** RCON adapter, server status, online player list and a mobile-friendly dashboard.
7. Java and Bedrock identity-aware allowlist management, desired/actual reconciliation, verified denial of unapproved identities, audit and operation status.
8. Scheduled, consistent backups and documented test restoration in a disposable world.
9. REST endpoints and OpenAPI schemas for these family features, with no arbitrary command endpoint.
10. Tests for child-role denial, server-scoped access, cross-tenant denial, expired credentials, fail-closed identity resolution, world preservation and private management ports.

## Engineering constraints

- Use TypeScript strict mode, pnpm, Fastify, Next.js, Drizzle/PostgreSQL, Redis/BullMQ, Zod and Pino, consistent with the original blueprint.
- Treat Minecraft server control and Minecraft bot play as distinct privilege domains.
- RCON is internal only and not encrypted by itself; do not expose it publicly.
- Do not give the dashboard/API Docker socket access. Introduce a constrained lifecycle broker only after F2 and with operator approval.
- Use official account authentication and strict allowlists, not a shared Minecraft password. Verify Floodgate-specific identity and allowlist commands against the installed plugin.
- No default paid inference. Management functions work without an LLM.
- Preserve original agent features in later phases: missions, task DAG, Mineflayer, multi-agent armies, model routing, memory, Kid Mode, emergency stop, coding/research adapters, optional Cloud.
- MCP later must use the same auth/RBAC/audit services and offer no arbitrary RCON or shell tool.
- Pin tested dependencies and image/plugin versions for production. Document upgrades and rollback.
- Keep deployment portable across VPS providers and home servers.

## Execution protocol

1. Read specs and inspect the repository. If the original blueprint is missing, use the bundled copy and report that fact.
2. Write a short implementation plan and security assumptions; do not block on nonessential questions.
3. Implement F0 first and run it in read-only mode. Present its findings and proposed changes; request confirmation before touching the live Minecraft server.
4. Implement F1 and F2 using a disposable test Minecraft instance and mock RCON first. Validate tests, lint, typecheck, migrations and Compose configuration.
5. Make deployment scripts idempotent and safe around unrelated Docker workloads. Never infer that the server is online because an API call was queued.
6. Demonstrate an end-to-end family access workflow and backup restore test. Mark family-ready only when all security gates pass.
7. Commit changes in coherent increments when Git is available; report tested functionality and outstanding risks truthfully.
8. Continue with original CraftLayer agent roadmap after family-ready milestone, retaining unified RBAC, audit, API and environment abstractions.

**Start now with the architecture docs, F0 read-only preflight, and the F1 project skeleton. Do not touch the live server without approval.**


## New mandatory requirement: Docker server provisioning (Unified Spec v0.4, Section 16)

After the family access and backup release gate (F2), implement **F2.5 Secure Docker Provisioning** before general multi-server features or autonomous agents. Read the complete Section 16 of `CRAFTLAYER_UNIFIED_SPEC.md`; it is normative.

Implement secure node enrollment, outbound mutually authenticated agent connections, a constrained Docker provisioning broker, capacity and port validation, declarative templates, dry-run plans, resource reservation, idempotent deployment jobs, readiness verification, rollback, lifecycle controls, audit, REST endpoints, secured MCP tools and a parent-friendly creation wizard. Provide a test template named **Family Survival**, target **contabo**, **Paper**, **4 GiB JVM heap** with adequate container overhead, **allowlist enforced**, and **daily backups**. Crossplay via Geyser/Floodgate requires verified compatible versions and transport configuration. Do not deploy until the adult accepts the EULA and explicitly authorizes the host changes.

**Preservation is non-negotiable:** the existing `minecraft-java` container and `/opt/minecraft-java/data` are to be adopted read-only first. Never recreate, migrate, delete, overwrite, start or stop that server without explicit operator approval. New provisioning must use distinct labelled resources and free ports. Deletion retains worlds and backups by default. Rollback may remove only resources created by the failed operation, never unrelated Docker workloads. Docker daemon access is host-root-equivalent: do not expose a public Docker API or mount the socket into the API, web, MCP or LLM worker.

Add acceptance tests for capacity/port conflicts, RBAC denial, cross-tenant isolation, credential replay, readiness, safe rollback, restart reconciliation, private management ports, Java/Bedrock allowlists, backup restoration, and non-interference with existing worlds. Implement and test on disposable infrastructure first. Report every security gate explicitly. Do not claim production readiness without passing them.
