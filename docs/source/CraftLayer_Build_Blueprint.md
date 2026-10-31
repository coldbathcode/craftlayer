# CraftLayer: Open-Source Agent Orchestration Platform
Version 0.2 | Build specification for Claude Code or Codex

## Vision
CraftLayer is an **open-source-first, self-hostable agent runtime and orchestration harness**. Users deploy the core on their own machines with Docker and connect their choice of AI model providers and execution environments. Minecraft is the first demonstration; coding and research armies follow. A separate **CraftLayer Cloud** service may later monetize managed hosting.

**Principle:** Self-hosted CraftLayer must remain fully useful without a cloud account, subscription, telemetry connection, or proprietary control plane.

## Product split

### CraftLayer Core (open source)
- Docker Compose deployment on Ubuntu, Mac or VPS.
- Agent runtime, fleet/group/mission/task orchestration.
- Multi-user accounts, role-based access control, audit history.
- Pluggable model providers and environment adapters.
- Dashboard, REST API, WebSocket event stream, CLI.
- Minecraft, coding and research example agent armies.
- Free-only model routing, quotas and fail-closed budget policies.
- Documentation, example configurations and upgrade scripts.
- No dependency on CraftLayer Cloud.

### CraftLayer Cloud (separate commercial service)
- Managed multi-tenant control plane and hosted agent workers.
- Tenant provisioning, billing, subscriptions and usage reporting.
- Bring-your-own-key (BYOK) model access, with tenant-isolated credentials.
- Optional platform-billed inference credits only after commercial/provider terms are checked.
- Managed backups, upgrades, observability and support.
- Optional hybrid deployment: Cloud dashboard orchestrates a user-owned runner over outbound authenticated connections. Core must not require this.
- Separate repositories/deployments and clear service boundaries; share the open-source core packages.

**Monetization recommendation:** Start with BYOK hosting fees, not token resale. Resale requires provider-specific permission, cost accounting, refunds, tax treatment, abuse controls and payment risk management.

## Suggested stack
TypeScript monorepo with pnpm; Fastify API + OpenAPI/Zod; Next.js dashboard; PostgreSQL + Drizzle; Redis/BullMQ; Docker Compose; Mineflayer for Minecraft; Pino logs. Keep the scheduler as a straightforward state machine before introducing a complex agent framework.

## Architecture
```text
Self-hosted:
Browser -> CraftLayer API/Auth/RBAC -> Orchestrator -> Queue -> Agent workers
                 |                        |                 |
              PostgreSQL               Task DAG       Environment adapters
                 |                                          | Minecraft/Mineflayer
             Audit/events                                   | Coding sandbox
                 |                                          | Research tools
                 +-> Model router -> OpenRouter/Ollama/Gemini/OpenAI/Anthropic
                                     /OpenAI-compatible endpoints

Hosted, later:
Cloud tenant portal -> tenant-isolated control plane -> hosted workers
                              |                       -> optional private runner
                          Billing/quotas
                              |
                         BYOK model router
```

## Users, organizations and RBAC
Support organizations/workspaces from the start, even in single-user self-hosted mode. Every group, mission, agent, environment, provider credential and event belongs to an organization; optionally scope access further by project/world.

Initial roles:
- **Instance Owner:** installation-wide settings, organization creation, backups, upgrades.
- **Org Admin:** invite users, manage roles, provider settings and budgets.
- **Operator:** create agents/groups, run missions, pause/stop fleets.
- **Builder:** create/edit mission templates and workflows; execute only where allowed.
- **Viewer:** read-only dashboards, status and logs.
- **Child:** launch approved Minecraft presets, manage assigned agents, no credentials, billing, terminal, code execution or player attacks.

Implement explicit permission strings, e.g. `mission:create`, `mission:execute`, `agent:assign`, `provider:manage`, `user:invite`, `billing:read`, `environment:admin`. Roles are collections of permissions; deny by default. Enforce permissions in the API and workers, not just the UI. Support per-world restrictions, ownership and resource scopes.

Local authentication: password login with secure hashing, sessions, password reset; optional OIDC later. Cloud: tenant-aware OIDC/social login later. Add invitations, user disable, session revocation, audit trails and emergency stop. Child accounts require adult-managed onboarding and restricted permissions. Never expose provider keys to browsers.

## Multi-tenancy
- Every database query and queued task must carry validated `organization_id` and, where relevant, `project_id`.
- Validate tenant isolation in API, background workers, WebSockets, event streams and storage.
- Self-hosted default is one organization but supports multiple.
- Hosted MVP: tenant-aware app with strong row-level access boundaries and per-tenant encryption/key separation. For untrusted code execution, use isolated containers/VMs, not shared processes.
- Add tenant quotas for concurrent agents, missions, tokens, CPU time and storage.
- Test cross-tenant access denial, including guessed resource IDs and queued jobs.

## Model provider layer
Provider adapters: OpenRouter, Ollama (local Llama models), Gemini, OpenAI, Anthropic and configurable OpenAI-compatible endpoints. Meta Llama is a model family served through local/hosted inference, not assumed to be a standalone API.

Example:
```yaml
model_policy:
  free_only: true
  allow_paid_fallback: false
  max_paid_spend_usd: 0
  fallback: [openrouter_free, local_ollama]
providers:
  openrouter_free:
    type: openrouter
    api_key_env: OPENROUTER_API_KEY
    verify_zero_price: true
    enabled: true
  local_ollama:
    type: ollama
    base_url: http://ollama:11434
    enabled: true
  gemini:
    type: gemini
    enabled: false
  openai:
    type: openai
    enabled: false
  anthropic:
    type: anthropic
    enabled: false
```
At request time, verify that a model is currently eligible under the configured cost policy. Unknown or stale pricing fails closed. Handle 429s by cooldown and fallback only to eligible models. If none are available, queue or pause the mission. **Free cloud inference cannot be guaranteed continuously**, but paid fallback can be prohibited. Track per-user, per-organization and per-mission consumption.

## Runtime and orchestration
Objects: Organization, User, Membership, Role, Permission, Project, Environment, Provider, Model, AgentTemplate, Agent, Group, Mission, Task, TaskDependency, Event, Approval, Budget.

Mission lifecycle: draft -> queued -> running -> paused/blocked -> succeeded/failed/cancelled. Task DAG scheduling with leases, retries, idempotency and worker heartbeats. Group shared memory uses a bounded event blackboard rather than endless agent conversations. Agent actions have time, token and tool budgets. Add an emergency stop at instance, org, world and mission scope.

Adapter interface:
```ts
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

## Minecraft example: Village Builders
Deploy a private Minecraft Java server and Mineflayer bot workers in Docker. Start with two or three bots and benchmark before scaling. Roles: Scout, Miner, Lumberjack, Courier, Builder, Guard, Quartermaster and Commander. Mission: `Build a small village`. Planner produces bounded subtasks; scouts identify resources; gatherers collect materials; couriers supply shared chests; builders follow deterministic blueprints; guards defend against hostile mobs. Disable PvP by default.

Kid Mode: choose world -> choose army -> choose preset mission. Large buttons, live progress, friendly agent cards, map/position view where supported, one obvious Stop All button. Adults manage world permissions, model credentials and budgets.

MVP success: two bots join a private test world, share tasks and finish a small build; status appears in dashboard; Stop All works.

## Coding example
Team: Architect, Developer, Tester, Reviewer, DevOps. Mission: `Build a simple habit tracker`. Work in isolated Git workspaces, run allowlisted commands, review diffs, require explicit approval for external deployment or destructive actions. Never expose production secrets to agents.

## Research example
Team: Researcher, Verifier, Analyst, Writer. Mission: `Compare hosting providers`. Fetch public sources, capture citations/dates, check claims and generate a Markdown report. Treat external content as untrusted; apply request limits and privacy safeguards.

## REST API (initial)
`/api/v1/auth/*`, `/api/v1/users`, `/api/v1/organizations`, `/api/v1/memberships`, `/api/v1/roles`, `/api/v1/projects`, `/api/v1/environments`, `/api/v1/providers`, `/api/v1/agents`, `/api/v1/groups`, `/api/v1/missions`, `/api/v1/missions/:id/pause`, `/api/v1/missions/:id/cancel`, `/api/v1/events/stream`, `/api/v1/emergency-stop`.
Generate OpenAPI specs and a typed client. Enforce server-side scopes, validation, audit and rate limits.

## Repository structure
```text
craftlayer/
  apps/api/
  apps/web/
  apps/worker/
  packages/core/
  packages/auth/
  packages/db/
  packages/orchestrator/
  packages/model-router/
  packages/provider-adapters/
  packages/environment-minecraft/
  packages/environment-coding/
  packages/environment-research/
  examples/minecraft-village/
  examples/coding-team/
  examples/research-team/
  docs/chapters/
  docs/architecture/
  infra/compose/
  docker-compose.yml
  .env.example
  README.md
```
Keep the future commercial project in `craftlayer-cloud/`, consuming versioned public packages/APIs. Avoid hidden cloud dependencies in Core.

## Chapter-by-chapter build plan
Each chapter needs a standalone spec, tests, acceptance criteria, docs and a review checkpoint.

**0. Foundation:** pnpm monorepo, TypeScript, CI, Docker Compose, README, health checks, ADRs. Pass: clean clone builds and checks pass.

**1. Identity and RBAC:** users, organizations, memberships, roles, permissions, sessions, invitations and audit. Pass: role tests and cross-org denial tests.

**2. Provider gateway:** OpenRouter and Ollama adapters, free-only routing, cooldown, budget ledger. Pass: unknown/paid model blocked and free fallback works under mocked 429.

**3. Fleet engine:** groups, agents, missions, task DAG, scheduler, worker leases, pause/resume and emergency stop. Pass: no duplicate task claims; state recovers after restart.

**4. Minecraft adapter:** Java server Compose, Mineflayer lifecycle, pathfinding, inventory and safe actions. Pass: bot connects, moves and completes a task.

**5. Dashboard and Kid Mode:** onboarding wizard, role-aware UI, group assignment, live events, preset missions. Pass: child-role user starts an approved mission in three steps but cannot manage provider keys.

**6. Cooperative armies:** Minecraft roles, shared resources, blueprint build, retries. Pass: 2-3 bots cooperate to complete a simple structure.

**7. More providers:** Gemini, OpenAI, Anthropic, generic compatible adapter, policy and usage controls. Pass: provider contract tests; all paid providers disabled by default.

**8. Coding and research adapters:** isolated workspaces, approval gates, cited reports. Pass: coding team produces reviewable patch; research team produces cited report.

**9. Self-hosted release:** setup wizard, backups, restore, monitoring, release images, multi-arch builds, upgrades, documentation and security review. Pass: documented fresh Ubuntu deployment works without CraftLayer Cloud.

**10. Cloud architecture (design only):** separate service boundaries, tenant provisioning, BYOK, usage metering, Stripe subscription model, hosted worker isolation and hybrid private runner. Pass: architecture and threat model reviewed; no Cloud code required to operate Core.

**11. Optional Cloud implementation:** only after self-hosted Core is stable and useful. Pass: tenant onboarding, BYOK isolation, metered infrastructure usage and billing tests.

## Deployment
Ubuntu mini PC: run API, dashboard, worker, PostgreSQL, Redis and Minecraft in Compose. Access through LAN or Tailscale. Keep admin APIs private. Persist world and database volumes; backups, health checks and memory limits required. Intel N150-class hardware should start with a few bots, not a large army. Local Ollama inference on this CPU may be slow; test small models or run inference on another machine.

Target setup once implemented:
```bash
git clone <craftlayer-repository-url>
cd craftlayer
cp .env.example .env
docker compose up -d --build
```
The repository URL is a placeholder, not a published project.

## Open-source and commercial strategy
Recommend **Apache-2.0** for Core if maximum adoption and commercial compatibility are priorities, subject to dependency/license review. MIT is an alternative. Publish a clear contribution guide, code of conduct, security policy, versioned APIs and release process. Cloud is a separately operated service charging for hosting, management, support, storage and optional usage. Do not assume an upstream model provider permits resale or pass-through billing: verify agreements and applicable legal, tax and privacy requirements first.

Suggested initial plans: Free self-hosted Core; Cloud Starter (BYOK); Cloud Team (collaboration, backups, quotas); Cloud Business (SSO, audit retention, dedicated workers). Pricing is intentionally TBD until infrastructure costs are measured.

## Branding
Working name **CraftLayer**. Candidate domains: craftlayer.dev, craftlayer.com, craftlayer.io, craftlayer.ai. **Availability and trademark clearance have not been verified.** Check registrar availability and existing marks before launch.

## Master prompt for Claude Code or Codex
> You are the lead engineer building CraftLayer. Read this Markdown file fully. First split its numbered chapters into `docs/chapters/00-foundation.md` through `11-cloud-implementation.md`. For each, produce objectives, architecture, tasks, tests, security considerations, acceptance criteria and dependencies. Write ADRs for major choices. Implement **Chapter 0 only** initially. Use TypeScript, Fastify, Next.js, PostgreSQL, Redis/BullMQ, Mineflayer and Docker Compose. Ensure self-hosted Core is independent of Cloud. Build RBAC and organization scoping into the foundation. Keep free-only model routing fail-closed. Do not use paid APIs or deploy publicly. Run tests, lint, typecheck and Compose validation. Summarize results and request approval before the next chapter. Do not claim untested work is complete.

## Definition of success
A nontechnical family can deploy or access a self-hosted instance, create users with safe roles, choose a Minecraft army, launch a mission and watch coordinated bots. A developer can connect their own models and build adapters. Later, a business can subscribe to CraftLayer Cloud without requiring existing self-hosted users to migrate.
