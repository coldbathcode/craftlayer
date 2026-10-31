# CraftLayer

Open-source-first, self-hostable agent orchestration. Minecraft is the first working example; coding and research teams follow.

**Repository status: Chapter 00 foundation implementation in progress.** See [current status](docs/delivery/status.md) and [build evidence](docs/delivery/build-log.md) for the exact checkpoint. Every build step updates the plan and is committed/pushed to `main`.

CraftLayer Core must work without a CraftLayer Cloud account, subscription, telemetry connection, license server, or proprietary control plane. Cloud is a later, separate project consuming public Core interfaces.

## Start here

1. Read [the documentation map](docs/README.md) and [product requirements](docs/product/requirements.md).
2. Read [AGENTS.md](AGENTS.md) for Codex and shared engineering instructions; Claude Code also reads [CLAUDE.md](CLAUDE.md).
3. Follow [the delivery roadmap](docs/delivery/roadmap.md), [backlog](docs/delivery/backlog.md), and [current status](docs/delivery/status.md).
4. Begin implementation only when requested, with [Chapter 00: Foundation](docs/chapters/00-foundation.md). Finish its review checkpoint before moving to Chapter 01 unless the user explicitly authorizes a larger scope.

## What this plan covers

- Twelve chapter specifications, each with ordered tasks, dependencies, security controls, tests, acceptance evidence, and handoff requirements.
- System boundaries, package layout, relational schema, authorization, runtime state machines, provider routing, contracts, and UI journeys.
- AI planning and evaluation, deterministic tool execution, cost accounting, Minecraft cooperation, isolated coding, and cited research.
- Local deployment, operational recovery, security review, release gates, and a separately gated commercial Cloud design.

The original [blueprint v0.2](docs/source/CraftLayer_Build_Blueprint.md) is preserved unchanged. Its embedded master prompt is reference material: this handoff expands the plan and does not claim Chapter 00 has been implemented.

## Delivery milestones

| Milestone | Chapters | User-visible outcome |
| --- | --- | --- |
| M0 — Engineering foundation | 00–01 | Reproducible development stack and secure organization accounts |
| M1 — Safe runtime | 02–03 | Fail-closed model policy and recoverable task execution |
| M2 — Minecraft vertical slice | 04–06 | Family-facing dashboard and 2–3 cooperating bots |
| M3 — Extensible Core | 07–08 | Additional providers, coding patches, cited research |
| M4 — Self-hosted release | 09 | Documented, backed-up, upgradeable Core release |
| M5 — Cloud design | 10 | Reviewed commercial architecture; no Cloud dependency in Core |
| M6 — Optional Cloud | 11 | Separate, explicitly authorized implementation |

## GitHub repository

The repository is [coldbathcode/craftlayer](https://github.com/coldbathcode/craftlayer), with `main` as the default branch. The local checkout uses it as `origin`.

```bash
git clone https://github.com/coldbathcode/craftlayer.git
cd craftlayer
```

Cloning provides the plan and the implementation recorded in current status. [GitHub setup](docs/delivery/github-setup.md) describes repository settings and the optional Project board.

## Licensing and unresolved choices

The blueprint proposes Apache-2.0, with MIT as an alternative. The plan records Apache-2.0 as a **candidate**, not an adopted license; no license grant is made here. Confirm the license and dependency review before public release. Hardware, model versions, Minecraft authentication/version compatibility, domains, commercial terms, and release dates remain in [the decision register](docs/delivery/risks-and-decisions.md).
