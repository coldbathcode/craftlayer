# CraftLayer

A private home for coordinated AI agents. Open-source first and self-hostable; Minecraft is the first planned working example, followed by coding and research teams.

**Chapter 00 foundation is implemented.** This preview includes a Next.js dashboard, Fastify API/OpenAPI, worker shell, CLI configuration checks, PostgreSQL tenant foundations, Redis connectivity and a private Docker Compose stack. Accounts, model routing and agent missions are the next chapters.

Core must work without CraftLayer Cloud, an entitlement service or required telemetry. Cloud remains a separate future service consuming public Core interfaces.

## Run the foundation

With Node 22.23.3, pnpm 10.23.0, Docker and Compose v2:

```bash
git clone https://github.com/coldbathcode/craftlayer.git
cd craftlayer
pnpm install --frozen-lockfile
pnpm setup:local
pnpm stack:up
```

Open **http://127.0.0.1:3000**. Only the web edge is published, on loopback. Setup generates local random credentials; no provider key or cloud account is needed. Follow the [developer quickstart](docs/development/quickstart.md) for prerequisites, commands, host development and troubleshooting. This is a local foundation preview; authentication and production release hardening are later work.

## Build and check

```bash
pnpm check
pnpm build
pnpm test:db
pnpm check:stack
pnpm test:offline
pnpm exec playwright install chromium
pnpm test:e2e
```

The browser/stack checks require the running stack. Database tests create a disposable instance. See [the foundation review](docs/reviews/00-foundation.md) for results, exact coverage and unverified features; no claim is made that later chapter behavior is implemented.

## Plan and agent instructions

- [Documentation map](docs/README.md): requirements, architecture, schema, security, API, UI, AI runtime and operational plans.
- [Current status](docs/delivery/status.md) and [build log](docs/delivery/build-log.md): exact stopping point and evidence.
- [Roadmap](docs/delivery/roadmap.md) and [84-task backlog](docs/delivery/backlog.md): twelve chapter specifications with dependencies and acceptance criteria.
- [AGENTS.md](AGENTS.md): shared Codex/Claude Code instructions; Claude Code also reads [CLAUDE.md](CLAUDE.md).
- [Foundation handoff](docs/delivery/handoffs/00-foundation.md): how to resume safely.

**Every build step updates the plan, commits and pushes to `main`.** This is the user's standing instruction. Chapter 00 is ready for review; the next chapter is [Identity and RBAC](docs/chapters/01-identity-and-rbac.md), starting with CL-01-01. Further chapters require their authorization.

## Milestones

| Milestone | Chapters | State / outcome |
| --- | --- | --- |
| Foundation | 00 | Implemented and verified; review evidence available |
| Secure accounts | 01 | Next: local auth, memberships, permissions and audit |
| Safe runtime | 02–03 | Planned: provider budgets, finite DAGs, recovery and stop |
| Minecraft vertical slice | 04–06 | Planned: dashboard/Kid Mode and 2–3 cooperating bots |
| Extensible Core | 07–08 | Planned: more providers, isolated coding and cited research |
| Self-hosted release | 09 | Planned: backups, upgrades, release images and security review |
| Separate Cloud | 10–11 | Design first; optional implementation in another repository |

The original [blueprint v0.2](docs/source/CraftLayer_Build_Blueprint.md) is preserved unchanged. The initial planning handoff was followed by the Chapter 00 build recorded in Git and delivery documents.

## Repository and licensing

Source: [coldbathcode/craftlayer](https://github.com/coldbathcode/craftlayer). Local work tracks `origin/main`; no GitHub Project board has been created. [GitHub setup](docs/delivery/github-setup.md) describes optional settings and issue organization.

Apache-2.0 remains the blueprint's candidate license; it has not been adopted and no license grant is made here. Dependency/license review and the final choice remain release decisions. Domain/trademark clearance, game compatibility, real provider behavior and Cloud pricing remain in [the risk register](docs/delivery/risks-and-decisions.md).
