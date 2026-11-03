# Engineering backlog

**Chapters 00–02 are implemented and accepted for advancement; CL-03-01–07 locally verified with Chapter 03 owner review pending; see [current status](status.md) and [build log](build-log.md).** This is an execution index, not evidence of completed implementation. Detailed implementation and acceptance requirements live at each linked chapter. Sizes indicate relative complexity only. Cloud tasks are optional separate-repository work.

This table preserves the original 84 numbered chapter tasks. The [16-task Minecraft management track](minecraft-track.md) adds F0 → F1 → F2 → F2.5 → F3 before new CL-04 bot work; F0 CL-F0-01–02 are locally verified with review prepared; F1 CL-F1-01–03 are locally verified with review prepared; F2 is now locally authorized/in progress at CL-F2-01 with a runnable pending-identity prototype; F2.5/F3 local capability development is now authorized by the VPS-management request; live operation/release gates remain. F1 depends on 00–01/F0, not bots or model routing. See [reconciliation](unified-reconciliation.md) for reuse and exact scope.

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
| [CL-03-07](../chapters/03-fleet-engine.md) | Runtime fault suite and review | CL-03-06 | L | Locally verified — review prepared; owner acceptance pending |
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

CL-F25-01 checkpoints A/B now include private trust, Hosts UI and a real local inventory/reconnect prototype. Signed effect commands remain open; next local task is CL-F25-02 template plans and constrained broker, with F2/F25 release gates retained. See [Hosts handoff](handoffs/F25-hosts.md).

CL-F25-02 checkpoint A now exposes the Family Survival template and scoped effect-free placement preview; reservations, signed execution and constrained broker are next. See [planning handoff](handoffs/F25-plans.md).

CL-F25-01 checkpoint C adds a private signed execution/permit/journal/fence/stop boundary; transport remains inventory-only. Next: durable resource reservations and a constrained broker. See [execution runbook](../development/node-execution.md).

CL-F25-02 checkpoint B adds private transactional reservations/port claims, current dual authority, dispatch revalidation and retained uncertain allocations. No execution endpoint or qualified production adapter exists. Next: constrained broker. See [reservation runbook](../development/node-reservations.md).

CL-F25-02 checkpoint C adds fixed approved image/resource/mount/network policy and guarded Engine verbs; no public execution path. Next: durable ownership/rollback runner and disposable host test. See [broker runbook](../development/node-broker.md).

CL-F25-02 checkpoint D adds durable broker creation provenance, lifecycle, retained-world rollback and truthful signed outcomes. Unknown effects stay blocked after restart/rotation. Next: disposable real Engine exercise, then controller jobs/authority integration. See [ownership ADR](../architecture/decisions/0023-node-broker-ownership.md).

CL-F25-02 checkpoint E adds repeatable real local non-Minecraft Docker lifecycle/compensation/lost-ack/preservation checks via `pnpm test:node:broker`. Persistent Minecraft quota/identity/recovery is still unqualified. Next: durable controller jobs and current authority integration. See [broker runbook](../development/node-broker.md).

CL-F25-03 checkpoint A adds immutable disabled deployment intake, current adult actor/session/node/dispatch binding and atomic audit/reference-only outbox. No lease/signer/worker/effect route exists. Next: durable physical job/attempt/fence/current-permit transport. See [intake runbook](../development/deployment-intents.md) and [progress review](../reviews/F25-secure-nodes.md).

CL-F25-03 checkpoint B adds private durable first-provision commands/leases, current dual-grant/qualifier checks, one-use node-signed fetch/permits and signed receipt/expiry settlement retaining uncertainty. No installed effect path or production qualifier exists. Next: outbound mTLS command transport and end-to-end disposable composition, with gateway/API key isolation retained. See [controller runbook](../development/deployment-jobs.md).

CL-F25-03 checkpoint C adds pinned outbound command/permit/receipt transport and optional gateway injection, verified with actual disposable DB/TLS/Redis Engine composition. Installed gateway/agent stays inventory-only. Next: remote current-authority adapter, independently verified approval and real host/world qualification, followed by production composition. See [controller runbook](../development/deployment-jobs.md).

CL-F25-03 checkpoint D adds a distinct signed private identity-authority proof service/client, current dual-grant validation without gateway identity secrets, proof-bounded writes/permits and final stop rechecks. Real DB/TLS/Redis flow uses a no-identity gateway. Next: API-only sealed-grant admission/separate gateway issuance, then installed approval/host/world qualification. See [authority ADR](../architecture/decisions/0025-remote-execution-authority.md).

CL-F25-03 checkpoint E adds API-side key-free sealed original-authority admission and gateway-side issue-by-reference, with immutable SQL 0023 links, stop/expiry preservation and reference-only outbox. The actual remote/TLS/Redis fixture now uses the split from its first job. Next: canonical HTTP/SDK metadata and background dispatch/polling, then qualified approval/host/world sources. See [controller runbook](../development/deployment-jobs.md).

## Status rules

- `Not started`: no implementation claim. `In progress`: active work with owner and branch recorded in status. `Blocked`: missing prerequisite, documented with next resolution action. `Implemented`: code exists but acceptance is incomplete. `Verified`: required evidence exists. `Accepted`: chapter checkpoint reviewed.
- Do not use a checked checkbox as a substitute for evidence. Link task IDs to test/review artifacts.
- Failed or unavailable checks prevent verification of their associated requirements. Do not count specification completion as software completion.
- When GitHub exists, create one issue per task (or a chapter epic with linked task issues), preserve these IDs in titles, and copy exact proof requirements. GitHub does not replace checked-in architecture/status.


CL-F25-03 checkpoint F completes local metadata-only HTTP/SDK admission and admission/job/operation status with strict headers/input, current adult dual scope, Origin/CSRF and secret-free projections. Remote entry/physical routes remain unavailable. Next: gateway background dispatch/polling/expiry with retained allocations and key isolation, followed by real approval/storage/game/recovery qualification. See [HTTP metadata handoff](handoffs/F25-http-metadata.md).

CL-F25-03/G adds bounded private outbox dispatch, rotating scan fairness and signature-bound denial-only expiry with retained allocations. Duplicate/lost-ack scans cannot renew or retry physical work; native scratch journey uses the dispatcher. Next: signed node job-reference polling, then installed qualification/recovery gates (ADR 0026).

CL-F25-03/H adds optional signed outbound node discovery of one exact issued reference over pinned mTLS, strict current scope/key/policy/stop/nonce checks and client response binding. It grants no effects; installed inventory remains unchanged. Next: bounded journal-aware node orchestration/receipt recovery, then private composition/real qualification (ADR 0026).

CL-F25-03/I adds a bounded private node runner, receipt-first durable delivery/acknowledgement and strict v1-to-v2 local journal upgrade preserving stop/fences/world/evidence. Lost acknowledgement only replays metadata; unresolved resources stay blocked. Native scratch test reopens after actual controller settlement without another create. Next: qualified private composition/credential recovery and real approval/storage/game/recovery; related preview maintenance remains (ADR 0027).

REV-04 maintenance fixes the dashboard's false timestamp/freshness implication using current authorized operation/server readback, unchanged-time/status/timestamp messaging and browser regression. Historical operation contracts are unchanged. The preserved unpublished review table still contains its original finding; this appended implementation record is current evidence. Next independent maintenance: REV-07 permission registry type/SQL parity guard.

REV-07 maintenance adds compile-time role/delegation permission vocabulary checks and exact real SQL seed parity against TypeScript; existing grants are unchanged. Preserved unpublished review rows retain their original state; this appended checkpoint is current implementation evidence. Next: REV-03 rolling management admission limits/history preservation.

REV-03/A removes lifetime management-operation lockout using rolling 24-hour/environment and existing minute/account budgets with compatible 429 and clearer retry guidance. History/audit/outbox remain retained; full DB window/replay/refusal/expiry tests added. Enrollment limits/deduplication and audited retention/archival remain open; next is expired pending-enrollment capacity (ADR 0028).

REV-03/B reclaims enrollment budget when immutable pending requests expire, retaining all history and denying verification/access. Current-auth UUID replay consumes no slot; active refusal preserves 429/code with expiry guidance. Additive SQL 0024 scoped time-range indexes/Drizzle and real upgrade fixtures support retained history. Semantic deduplication/audited archival remain open; original CL-03-07 qualification can continue independently.

CL-03-07 / REV-01: runtime faults locally verified; paired event/mission grants, budget projection and disposable Redis/restart/crash/partition evidence close the preserved implementation gap. [Chapter review](../reviews/03-fleet-engine.md) is prepared for owner acceptance; Chapter 04 is not authorized. F2/F25/F3 local delivery and REV-03 semantic deduplication remain available next steps.

REV-03/C / REV-06 partial: active exact parsed-name deduplication with different UUID keys now denies a duplicate before mutation, retaining original replay/current authority/expiry/history and false identity/access. Concurrent and HTTP boundary evidence is recorded in build log. Next local checkpoint is stable chronological enrollment pagination; archival and actual identity qualification remain open.

REV-06: newest-first enrollment history uses exact database timestamp/UUID seek anchors with existing scoped UUID cursor schema and SQL 0025 index. Multi-page/microsecond/tie/arrival/foreign-anchor evidence is in build log. Exact-name deduplication was delivered in REV-03/C; explicit withdrawal and audited archival remain separate. F2 real identity/access/recovery gates are still open.

REV-09: management browser qualification is now an unconditional job in the main/PR workflow; explicit suite matching and missing-fixture failure replace silent management skips. Local/hosted results are recorded separately in build log. Branch-protection rules are unchanged; physical Minecraft/family gates remain open.
