# Documentation map and reading order

**Status:** Chapters 00–02 implemented and locally verified; Chapter 02 owner review is pending and Chapter 03 requires authorization; see [current checkpoint](delivery/status.md). Begin with the root [README](../README.md) and [AGENTS.md](../AGENTS.md). Claude Code also reads [CLAUDE.md](../CLAUDE.md).

## Planning layers

| Layer | Purpose | Read |
| --- | --- | --- |
| Source | Preserve original product intent | [Blueprint v0.2](source/CraftLayer_Build_Blueprint.md), [coverage map](product/blueprint-coverage.md) |
| Product | Define personas, scope, outcomes and targets | [Requirements](product/requirements.md), [dashboard journeys](product/dashboard-and-journeys.md) |
| Architecture | Explain contracts and engineering decisions | Files below plus [ADRs](architecture/decisions/README.md) |
| Execution | Ordered implementation with proof per task | [Roadmap](delivery/roadmap.md), [backlog](delivery/backlog.md), chapter files |
| Verification | Define meaningful automated/manual evidence | [Testing strategy](testing/strategy.md), chapter criteria |
| Operations | Make local deployment and recovery reproducible | [Deployment/recovery](operations/deployment-and-recovery.md) |
| Continuity | Let sessions resume without losing decisions | [Status](delivery/status.md), [risk register](delivery/risks-and-decisions.md), templates |

## Architecture specifications

- [System topology, packages and dependency rules](architecture/system-design.md).
- [Relational schema, queries, RLS and migrations](architecture/data-model.md).
- [Runtime state machines, scheduling, AI tools and recovery](architecture/runtime-and-agents.md).
- [Provider eligibility, budgets, ledger and credentials](architecture/model-routing.md).
- [Identity, permissions, child controls and threat model](architecture/security-and-access.md).
- [REST, event stream, CLI and adapter contracts](architecture/api-and-events.md).
- [Minecraft roles, blueprint, reservations and benchmarks](architecture/minecraft-cooperation.md).
- [Coding isolation, approval workflow and research provenance](architecture/coding-and-research.md).
- [Separate Cloud responsibilities and hybrid runner boundary](architecture/cloud-boundaries.md).
- [Primary references and chapter research requirements](research/primary-sources.md).

## Chapter specifications

| Chapter | Specification |
| --- | --- |
| 00 | [Foundation](chapters/00-foundation.md) |
| 01 | [Identity and RBAC](chapters/01-identity-and-rbac.md) |
| 02 | [Provider gateway](chapters/02-provider-gateway.md) |
| 03 | [Fleet engine](chapters/03-fleet-engine.md) |
| 04 | [Minecraft adapter](chapters/04-minecraft-adapter.md) |
| 05 | [Dashboard and Kid Mode](chapters/05-dashboard-and-kid-mode.md) |
| 06 | [Cooperative armies](chapters/06-cooperative-armies.md) |
| 07 | [Additional providers](chapters/07-additional-providers.md) |
| 08 | [Coding and research](chapters/08-coding-and-research.md) |
| 09 | [Self-hosted release](chapters/09-self-hosted-release.md) |
| 10 | [Cloud architecture — design only](chapters/10-cloud-architecture.md) |
| 11 | [Optional separate Cloud implementation](chapters/11-cloud-implementation.md) |

## Agent and project workflow

- [Planning validation and its limits](delivery/planning-validation.md).
- [Reusable agent prompts](delivery/agent-prompts.md).
- [GitHub repository / optional Project board setup](delivery/github-setup.md).
- [Engineering task template](templates/engineering-task.md).
- [Chapter review template](templates/chapter-review.md).
- [Agent session handoff template](templates/agent-handoff.md).

Read the current status before choosing a task. Specifications are proposed implementation contracts. A chapter's acceptance checkboxes remain unchecked until real evidence exists; neither a detailed plan nor an initial Git commit means the software is implemented.

## Implemented foundation

[Developer quickstart](development/quickstart.md), [compatibility matrix](development/compatibility.md), [chapter review](reviews/00-foundation.md), and [session handoff](delivery/handoffs/00-foundation.md) record the runnable foundation and its exact limits. Every build step updates the plan and is committed/pushed to main.

## Implemented local identity

[Account/recovery runbook](development/identity-and-recovery.md), [identity chapter review](reviews/01-identity-and-rbac.md), and [identity handoff](delivery/handoffs/01-identity-and-rbac.md) describe the account console, real database/browser checks, recovery and remaining scope.

## Implemented provider gateway

[Provider and budget runbook](development/providers-and-budgets.md), [provider review](reviews/02-provider-gateway.md) and [provider handoff](delivery/handoffs/02-provider-gateway.md) record protected optional configuration, conservative adapters/accounting and current qualification limits. No live inference is implied.
