# CraftLayer

One self-hostable Core for safe family Minecraft management and coordinated AI agents. The immediate plan is preserving/adopting the existing server, verified player access/backups, then secure Docker provisioning; agent, coding and research capabilities remain on the roadmap.

**Chapters 00–02 are implemented and verified locally.** This preview includes private local accounts, owner setup/recovery, organization roles and scoped access, adult invitations, child accounts, sessions/audit, an account console, typed API contracts and the private Docker stack. The server provider gateway adds encrypted connections, conservative routing, persistent stop and durable budgets. Simulation fleet/runtime tasks CL-03-01–06 are implemented with recorded evidence; final runtime qualification is open. F0 preservation tooling and the F1 local read-only server dashboard/API are implemented; live adoption, verified player access/backups, provisioning and bots remain gated.

Core must work without CraftLayer Cloud, an entitlement service or required telemetry. Cloud remains a separate future service consuming public Core interfaces.

## Try the family prototype

Run `pnpm prototype:up`, then open **http://127.0.0.1:3001/servers** (the command prints a different loopback URL if that port is occupied). Private parent/viewer/child sign-in details are generated in `.craftlayer-prototype/START-HERE.md`. Try simulated servers, players, activity and persistent pending identity requests. Open **http://127.0.0.1:3001/nodes** for host enrollment, real local Docker inventory and the Family Survival deployment preview; the prototype guide explains the foreground inventory agent. `pnpm prototype:down` stops the separate prototype while retaining its data. [Prototype guide](docs/development/prototype.md).

This prototype uses synthetic server data, grants no game access, and leaves the existing installation/Contabo/worlds untouched. F2 authenticated identities, allowlists and backups remain in progress.

## Run the foundation

With Node 22.23.3, pnpm 10.23.0, Docker and Compose v2:

```bash
git clone https://github.com/coldbathcode/craftlayer.git
cd craftlayer
pnpm install --frozen-lockfile
pnpm setup:local
pnpm stack:up
```

Open **http://127.0.0.1:3000**. Only the web edge is published, on loopback. Setup generates local random credentials; no provider key or cloud account is needed. Follow the [developer quickstart](docs/development/quickstart.md) for prerequisites, commands, host development and troubleshooting. Open **http://127.0.0.1:3000/account** for first-owner setup and administration. Follow the [identity/recovery runbook](docs/development/identity-and-recovery.md). New installations require owner setup; preserve existing account state. Open **http://127.0.0.1:3000/servers** after building the current code for the local observation dashboard; configure an approved source using the [management runbook](docs/development/minecraft-management.md). Existing running installations are not automatically upgraded by a Git push. Production release hardening remains Chapter 09.

## Build and check

```bash
pnpm check
pnpm build
pnpm test:db
pnpm check:stack
pnpm test:offline
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:identity-ui
pnpm test:server-ui
pnpm test:provider-stack
```

Foundation browser/stack checks require the running stack. Database, identity UI and server UI checks create disposable installations and clean up only their own resources. See [the provider review](docs/reviews/02-provider-gateway.md), [provider runbook](docs/development/providers-and-budgets.md), [the identity review](docs/reviews/01-identity-and-rbac.md) and [foundation review](docs/reviews/00-foundation.md) for results, exact coverage and unverified features; no claim is made that later chapter behavior is implemented.

## Plan and agent instructions

- [Documentation map](docs/README.md): requirements, architecture, schema, security, API, UI, AI runtime and operational plans.
- [Current status](docs/delivery/status.md) and [build log](docs/delivery/build-log.md): exact stopping point and evidence.
- [Roadmap](docs/delivery/roadmap.md) and [original chapter backlog](docs/delivery/backlog.md): twelve chapter specifications with dependencies and acceptance criteria.
- [AGENTS.md](AGENTS.md): shared Codex/Claude Code instructions; Claude Code also reads [CLAUDE.md](CLAUDE.md).
- [F1 handoff](docs/delivery/handoffs/F1-control-plane.md) and [management runbook](docs/development/minecraft-management.md): local dashboard/API, approved sources, evidence and the next F2 authorization boundary.

**Every build step updates the plan, commits and pushes to `main`.** This is the user's standing instruction. [Current status](docs/delivery/status.md) records the evidence. Chapter 03’s remaining authorized task is CL-03-07, whose existing work remains preserved. The Minecraft implementation sequence is in the current status; the next node task is signed execution/journal/fencing before transactional reservations and a constrained broker. [Unified reconciliation](docs/delivery/unified-reconciliation.md) and the [Minecraft track](docs/delivery/minecraft-track.md) define F0–F3; F0 local tooling is now verified ([review](docs/reviews/F0-preflight.md)); F1 local implementation is complete with review prepared; F2/F2.5/F3 local capability development is now authorized; current work includes node trust, Hosts and deployment previews. All Contabo operations still need separate authorization; signed physical commands, actual provisioning and family security/recovery remain open.

## Milestones

| Milestone | Chapters | State / outcome |
| --- | --- | --- |
| Foundation | 00 | Implemented and verified; review evidence available |
| Secure accounts | 01 | Implemented and verified; accepted for advancement |
| Provider gateway | 02 | Implemented and verified; accepted for advancement |
| Fleet runtime | 03 | Six tasks verified; final fault/restart review remains |
| Family management | F0–F3 | F0 tools + F1 local observation dashboard implemented; access/backups/provisioning/lifecycle remain planned |
| Minecraft vertical slice | 04–06 | Planned: dashboard/Kid Mode and 2–3 cooperating bots |
| Extensible Core | 07–08 | Planned: more providers, isolated coding and cited research |
| Self-hosted release | 09 | Planned: backups, upgrades, release images and security review |
| Separate Cloud | 10–11 | Design first; optional implementation in another repository |

The original [blueprint v0.2](docs/source/CraftLayer_Build_Blueprint.md) is preserved unchanged. The initial planning handoff was followed by the Chapters 00–02 builds recorded in Git and delivery documents.

## Repository and licensing

Source: [coldbathcode/craftlayer](https://github.com/coldbathcode/craftlayer). Local work tracks `origin/main`; no GitHub Project board has been created. [GitHub setup](docs/delivery/github-setup.md) describes optional settings and issue organization.

Apache-2.0 remains the blueprint's candidate license; it has not been adopted and no license grant is made here. Dependency/license review and the final choice remain release decisions. Domain/trademark clearance, game compatibility, real provider behavior and Cloud pricing remain in [the risk register](docs/delivery/risks-and-decisions.md).
