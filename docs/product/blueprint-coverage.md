# Blueprint coverage and deliberate refinements

The original [blueprint v0.2](../source/CraftLayer_Build_Blueprint.md) is unchanged. This map shows where each section is expanded and identifies engineering refinements rather than silently treating them as original requirements.

| Blueprint section | Expanded specification |
| --- | --- |
| Vision / Core–Cloud split | [Requirements](requirements.md), [Cloud boundary](../architecture/cloud-boundaries.md), ADR 0002 |
| Suggested stack / architecture / repo structure | [System design](../architecture/system-design.md), Chapter 00, ADR 0001 |
| Users, organizations, RBAC, local auth | [Security/access](../architecture/security-and-access.md), [data model](../architecture/data-model.md), Chapter 01 |
| Multi-tenancy and quotas | Data model, security/access, [model routing](../architecture/model-routing.md), Chapters 01–03, 10–11 |
| Provider layer / free-only behavior | Model routing, Chapters 02/07, ADR 0005 |
| Runtime objects, lifecycle, DAG, memory, stop | [Runtime](../architecture/runtime-and-agents.md), Chapters 03/06, ADRs 0004/0006/0007 |
| Minecraft roles and village / child flow | [Minecraft](../architecture/minecraft-cooperation.md), [dashboard journeys](dashboard-and-journeys.md), Chapters 04–06 |
| Coding/research examples | [Execution design](../architecture/coding-and-research.md), Chapter 08, ADR 0009 |
| REST/events/CLI | [API contracts](../architecture/api-and-events.md), Chapters 00/03/05/09, ADR 0010 |
| Chapter-by-chapter build | [Roadmap](../delivery/roadmap.md), twelve standalone chapter specs, [84-task backlog](../delivery/backlog.md) |
| Deployment / hardware / backups | [Operations](../operations/deployment-and-recovery.md), Chapter 09, risk register |
| Open source / commercial / branding | Risk/decision register, GitHub setup, Chapters 09–11 |
| Master prompt and checkpoints | AGENTS.md, CLAUDE.md, [agent prompts](../delivery/agent-prompts.md), review/handoff templates |
| Definition of success | Requirements, [test mapping](../testing/strategy.md), M2/M4 review gates |

## Refinements added by this planning pass

- PostgreSQL RLS, tenant-aware composite FKs and transaction-local context complement the blueprint's required tenant isolation. They are recommended design controls, not claims that a schema already exists.
- Transactional outbox, explicit fences and uncertain-effect reconciliation make queue retries/restart behavior implementable. Exactly-once physical effects are intentionally not promised.
- A 5×5 shelter with explicit bill of materials and prepared-world benchmark makes the initial “small build” measurable. A later survival/village demonstration has distinct assumptions.
- `contracts`, `config`, `sdk`, `testkit`, `agent-runtime` and CLI packages clarify responsibilities beyond the initial repository sketch.
- Pricing TTL, loop/task caps, stop timing, retention and performance numbers are proposed test targets/defaults, not measured facts or upstream guarantees.
- Strict free-only paths must account for provider-side pricing/feature/fallback behavior. Catalog metadata alone cannot absolutely guarantee an upstream invoice.
- License, domains, real model selection, exact versions, sandbox runtime, dates and Cloud prices remain decisions with explicit gates.
- This task produces a planning repository. The blueprint's embedded request to implement Chapter 00 is preserved as source text and scoped to a later explicit build request.
