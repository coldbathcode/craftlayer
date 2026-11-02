# Engineering backlog

**Chapters 00–02 are implemented and accepted for advancement; CL-03-01–06 verified, CL-03-07 open; see [current status](status.md) and [build log](build-log.md).** This is an execution index, not evidence of completed implementation. Detailed implementation and acceptance requirements live at each linked chapter. Sizes indicate relative complexity only. Cloud tasks are optional separate-repository work.

This table preserves the original 84 numbered chapter tasks. The [16-task Minecraft management track](minecraft-track.md) adds F0 → F1 → F2 → F2.5 → F3 before new CL-04 bot work; F0 CL-F0-01–02 are locally verified with review prepared; F1 is now authorized with CL-F1-01 verified and CL-F1-02 next; F2 onward needs explicit authorization. F1 depends on 00–01/F0, not bots or model routing. See [reconciliation](unified-reconciliation.md) for reuse and exact scope.

Each original chapter is a conservative dependency chain of seven reviewable tasks. Dependencies may be refined during implementation with documented justification; never reorder around a safety gate. Chapters 07/08 have technical opportunities for independent work, but chapter authorization and acceptance still apply.

| Task | Work item | Dependency | Size | State |
| --- | --- | --- | --- | --- |
| [CL-00-01](../chapters/00-foundation.md) | Compatibility and toolchain decision | None | M | Verified |
| [CL-00-02](../chapters/00-foundation.md) | Workspace and dependency boundaries | CL-00-01 | M | Verified |
| [CL-00-03](../chapters/00-foundation.md) | Database and organization foundation | CL-00-02 | L | Verified |
| [CL-00-04](../chapters/00-foundation.md) | Application shells and validated configuration | CL-00-03 | M | Verified |
| [CL-00-05](../chapters/00-foundation.md) | Private Compose development stack | CL-00-04 | L | Verified |
| [CL-00-06](../chapters/00-foundation.md) | Automated checks and CI | CL-00-05 | L | Verified |
| [CL-00-07](../chapters/00-foundation.md) | Developer quickstart and foundation review | CL-00-06 | M | Verified |
| [CL-01-01](../chapters/01-identity-and-rbac.md) | Identity schema and role seeds | Chapter 00 gate | L | Verified |
| [CL-01-02](../chapters/01-identity-and-rbac.md) | Secure bootstrap and password sessions | CL-01-01 | L | Verified |
| [CL-01-03](../chapters/01-identity-and-rbac.md) | Authorization and resource scopes | CL-01-02 | L | Verified |
| [CL-01-04](../chapters/01-identity-and-rbac.md) | Invitations and lifecycle management | CL-01-03 | L | Verified |
| [CL-01-05](../chapters/01-identity-and-rbac.md) | Password recovery and child accounts | CL-01-04 | M | Verified |
| [CL-01-06](../chapters/01-identity-and-rbac.md) | Identity API and audit projection | CL-01-05 | M | Verified |
| [CL-01-07](../chapters/01-identity-and-rbac.md) | Isolation and revocation review | CL-01-06 | L | Verified |
| [CL-02-01](../chapters/02-provider-gateway.md) | Provider and pricing contracts | Chapter 01 gate | M | Verified |
| [CL-02-02](../chapters/02-provider-gateway.md) | Credential and connection management | CL-02-01 | L | Verified |
| [CL-02-03](../chapters/02-provider-gateway.md) | Ollama adapter | CL-02-02 | M | Verified |
| [CL-02-04](../chapters/02-provider-gateway.md) | OpenRouter adapter | CL-02-03 | L | Verified |
| [CL-02-05](../chapters/02-provider-gateway.md) | Policy and cooldown router | CL-02-04 | L | Verified |
| [CL-02-06](../chapters/02-provider-gateway.md) | Budget ledger and reconciliation | CL-02-05 | L | Verified |
| [CL-02-07](../chapters/02-provider-gateway.md) | Gateway review and operator docs | CL-02-06 | M | Verified |
| [CL-03-01](../chapters/03-fleet-engine.md) | Domain schema and finite state machines | Chapter 02 gate | L | Verified |
| [CL-03-02](../chapters/03-fleet-engine.md) | Mission API, grants and CLI | CL-03-01 | L | Verified |
| [CL-03-03](../chapters/03-fleet-engine.md) | Outbox and fair scheduler | CL-03-02 | L | Verified |
| [CL-03-04](../chapters/03-fleet-engine.md) | Worker claims and bounded runtime | CL-03-03 | L | Verified |
| [CL-03-05](../chapters/03-fleet-engine.md) | Pause, cancel and emergency stop | CL-03-04 | L | Verified |
| [CL-03-06](../chapters/03-fleet-engine.md) | Authorized event projection and recovery | CL-03-05 | L | Verified |
| [CL-03-07](../chapters/03-fleet-engine.md) | Runtime fault suite and review | CL-03-06 | L | Not started |
| [CL-04-01](../chapters/04-minecraft-adapter.md) | Server, protocol and authentication spike | Chapter 03 + F3 gates; explicit Chapter 04 authorization | L | Not started |
| [CL-04-02](../chapters/04-minecraft-adapter.md) | Private world Compose profile | CL-04-01 | M | Not started |
| [CL-04-03](../chapters/04-minecraft-adapter.md) | Bot lifecycle and single-session ownership | CL-04-02 | L | Not started |
| [CL-04-04](../chapters/04-minecraft-adapter.md) | Observation and navigation primitives | CL-04-03 | L | Not started |
| [CL-04-05](../chapters/04-minecraft-adapter.md) | Inventory and build action library | CL-04-04 | L | Not started |
| [CL-04-06](../chapters/04-minecraft-adapter.md) | Disconnect and uncertain-effect recovery | CL-04-05 | L | Not started |
| [CL-04-07](../chapters/04-minecraft-adapter.md) | Adapter contracts and safety review | CL-04-06 | M | Not started |
| [CL-05-01](../chapters/05-dashboard-and-kid-mode.md) | Design system and screen contracts | Chapter 04 gate | M | Not started |
| [CL-05-02](../chapters/05-dashboard-and-kid-mode.md) | Adult onboarding and account shell | CL-05-01 | L | Not started |
| [CL-05-03](../chapters/05-dashboard-and-kid-mode.md) | Fleet and mission control surfaces | CL-05-02 | L | Not started |
| [CL-05-04](../chapters/05-dashboard-and-kid-mode.md) | Events, reconnect and scoped cache | CL-05-03 | L | Not started |
| [CL-05-05](../chapters/05-dashboard-and-kid-mode.md) | Adult-approved presets and child launch | CL-05-04 | L | Not started |
| [CL-05-06](../chapters/05-dashboard-and-kid-mode.md) | Safety, accessibility and private projections | CL-05-05 | L | Not started |
| [CL-05-07](../chapters/05-dashboard-and-kid-mode.md) | Browser acceptance and handoff | CL-05-06 | L | Not started |
| [CL-06-01](../chapters/06-cooperative-armies.md) | Blueprint and outcome fixture | Chapter 05 gate | M | Not started |
| [CL-06-02](../chapters/06-cooperative-armies.md) | Role templates and bounded planner | CL-06-01 | L | Not started |
| [CL-06-03](../chapters/06-cooperative-armies.md) | Blackboard and resource reservations | CL-06-02 | L | Not started |
| [CL-06-04](../chapters/06-cooperative-armies.md) | Cooperative supply and placement | CL-06-03 | L | Not started |
| [CL-06-05](../chapters/06-cooperative-armies.md) | Failure recovery and safe guards | CL-06-04 | L | Not started |
| [CL-06-06](../chapters/06-cooperative-armies.md) | Cooperation benchmarks and child preset | CL-06-05 | L | Not started |
| [CL-06-07](../chapters/06-cooperative-armies.md) | Vertical-slice review and evidence | CL-06-06 | M | Not started |
| [CL-07-01](../chapters/07-additional-providers.md) | Provider capability and terms matrix | Chapter 06 gate | M | Not started |
| [CL-07-02](../chapters/07-additional-providers.md) | Gemini adapter | CL-07-01 | L | Not started |
| [CL-07-03](../chapters/07-additional-providers.md) | OpenAI adapter | CL-07-02 | L | Not started |
| [CL-07-04](../chapters/07-additional-providers.md) | Anthropic adapter | CL-07-03 | L | Not started |
| [CL-07-05](../chapters/07-additional-providers.md) | Compatible-endpoint adapter | CL-07-04 | L | Not started |
| [CL-07-06](../chapters/07-additional-providers.md) | Provider policy parity and usage review | CL-07-05 | L | Not started |
| [CL-07-07](../chapters/07-additional-providers.md) | Extension documentation and review | CL-07-06 | M | Not started |
| [CL-08-01](../chapters/08-coding-and-research.md) | Sandbox threat model and runner spike | Chapter 07 gate | L | Not started |
| [CL-08-02](../chapters/08-coding-and-research.md) | Coding workspace and command policy | CL-08-01 | L | Not started |
| [CL-08-03](../chapters/08-coding-and-research.md) | Coding team workflow and artifacts | CL-08-02 | L | Not started |
| [CL-08-04](../chapters/08-coding-and-research.md) | Exact-action approval gates | CL-08-03 | L | Not started |
| [CL-08-05](../chapters/08-coding-and-research.md) | Research safe retrieval and provenance | CL-08-04 | L | Not started |
| [CL-08-06](../chapters/08-coding-and-research.md) | Claim verification and report production | CL-08-05 | L | Not started |
| [CL-08-07](../chapters/08-coding-and-research.md) | Isolation/evaluation review and examples | CL-08-06 | L | Not started |
| [CL-09-01](../chapters/09-self-hosted-release.md) | Release inventory and compatibility | Chapter 08 gate | M | Not started |
| [CL-09-02](../chapters/09-self-hosted-release.md) | Production Compose and setup experience | CL-09-01 | L | Not started |
| [CL-09-03](../chapters/09-self-hosted-release.md) | Backup, restore and key recovery | CL-09-02 | L | Not started |
| [CL-09-04](../chapters/09-self-hosted-release.md) | Upgrade and interrupted-migration drill | CL-09-03 | L | Not started |
| [CL-09-05](../chapters/09-self-hosted-release.md) | Observability and resource qualification | CL-09-04 | L | Not started |
| [CL-09-06](../chapters/09-self-hosted-release.md) | Security and supply-chain release gate | CL-09-05 | L | Not started |
| [CL-09-07](../chapters/09-self-hosted-release.md) | Signed/versioned release rehearsal | CL-09-06 | L | Not started |
| [CL-10-01](../chapters/10-cloud-architecture.md) | Service and package boundary design | Chapter 09 gate | M | Not started |
| [CL-10-02](../chapters/10-cloud-architecture.md) | Tenant provisioning and identity design | CL-10-01 | L | Not started |
| [CL-10-03](../chapters/10-cloud-architecture.md) | BYOK and hosted execution isolation | CL-10-02 | L | Not started |
| [CL-10-04](../chapters/10-cloud-architecture.md) | Metering and subscription design | CL-10-03 | L | Not started |
| [CL-10-05](../chapters/10-cloud-architecture.md) | Hybrid outbound runner protocol | CL-10-04 | L | Not started |
| [CL-10-06](../chapters/10-cloud-architecture.md) | Operations, portability and commercial review | CL-10-05 | L | Not started |
| [CL-10-07](../chapters/10-cloud-architecture.md) | Architecture approval package | CL-10-06 | M | Not started |
| [CL-11-01](../chapters/11-cloud-implementation.md) | Separate Cloud foundation | Chapter 10 gate | L | Not started |
| [CL-11-02](../chapters/11-cloud-implementation.md) | Tenant onboarding and provisioning | CL-11-01 | L | Not started |
| [CL-11-03](../chapters/11-cloud-implementation.md) | BYOK credentials and hosted workers | CL-11-02 | L | Not started |
| [CL-11-04](../chapters/11-cloud-implementation.md) | Infrastructure metering and subscriptions | CL-11-03 | L | Not started |
| [CL-11-05](../chapters/11-cloud-implementation.md) | Managed operations and support | CL-11-04 | L | Not started |
| [CL-11-06](../chapters/11-cloud-implementation.md) | Optional hybrid beta | CL-11-05 | L | Not started |
| [CL-11-07](../chapters/11-cloud-implementation.md) | Private beta and launch gate | CL-11-06 | L | Not started |

## Status rules

- `Not started`: no implementation claim. `In progress`: active work with owner and branch recorded in status. `Blocked`: missing prerequisite, documented with next resolution action. `Implemented`: code exists but acceptance is incomplete. `Verified`: required evidence exists. `Accepted`: chapter checkpoint reviewed.
- Do not use a checked checkbox as a substitute for evidence. Link task IDs to test/review artifacts.
- Failed or unavailable checks prevent verification of their associated requirements. Do not count specification completion as software completion.
- When GitHub exists, create one issue per task (or a chapter epic with linked task issues), preserve these IDs in titles, and copy exact proof requirements. GitHub does not replace checked-in architecture/status.
