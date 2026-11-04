# Product requirements and traceable outcomes

Status: unified product contract reconciled 2026-11-02. Sources: unchanged [blueprint v0.2](../source/CraftLayer_Build_Blueprint.md), [unified v0.4](../CRAFTLAYER_UNIFIED_SPEC.md) and [build prompt](../BUILD_PROMPT.md). IDs are stable; implementation evidence lives in [status](../delivery/status.md), not in these requirement tables. PR-023–035 are new requirements: F0/F1 are locally implemented; F2 pending identity requests and F2.5 node trust/Hosts/deployment previews are partial implementations. Actual game access, backups, provisioning and production gates remain unverified. Completed invariants remain binding.

## Product purpose

One open-source self-hosted Core combines safe Minecraft server management, registered Docker hosts and the preserved agent runtime, identity/RBAC, audit, dashboard, REST, jobs/events and later secured MCP. Core works without Cloud, internet entitlement checks or an LLM. Developers can connect models and build adapters; optional Cloud remains separately implemented.

Immediate outcome: preserve the existing family world, adopt its server read-only, then provide verified Java/Bedrock access control and recoverable backups in a parent dashboard. Docker provisioning follows family safety. Two-bot construction remains a later outcome, with reliable Stop All; no completed orchestration work is rebuilt.

## Personas and jobs

| Persona | Job to accomplish | Constraints |
| --- | --- | --- |
| Instance owner | Install, recover, upgrade, manage organizations | Own hardware; no Cloud account; explicit administrative powers |
| Adult org administrator | Invite family/team, configure worlds, models, limits | Credentials remain server-side; all policy changes audited |
| Operator | Assemble an army, run and stop missions | Only approved environments and delegated permissions |
| Builder | Design versioned templates and bounded workflows | Editing does not imply executing or approving |
| Viewer | Understand progress and failure reasons | No writes and no private provider metadata |
| Child | Choose world, army, preset; watch and stop assigned bots | Adult-created identity; predefined safe inputs; no arbitrary tools |
| Adapter developer | Add providers/environments with contract tests | Core contracts are versioned; no SDK coupling to scheduler |

## Functional requirements

| ID | Requirement | Delivery / proof |
| --- | --- | --- |
| PR-001 | Core starts without Cloud identity, license calls, telemetry, billing, or a proprietary control plane | 00, 09; blocked-Cloud-network deployment test |
| PR-002 | Multi-user local identity, organizations, project/world scopes, roles, invitations, disable/revoke/reset | 01; permission and session tests |
| PR-003 | Every tenant-owned resource and execution path enforces organization context | 01–09; adversarial tenant isolation suite |
| PR-004 | Provider keys are server-only, encrypted at rest when stored, rotated and redacted | 01–02, 07; secret canary scan |
| PR-005 | OpenRouter and Ollama work behind normalized provider contracts | 02; fake contract suite plus opt-in smoke |
| PR-006 | Free-only policy rejects unknown, stale, nonzero, and unbounded price dimensions; paid fallback defaults off | 02, 07; zero paid dispatch assertions |
| PR-007 | Hierarchical budgets and quotas cover tokens, requests, runtime, agents, storage, missions and optional paid spend | 02–03; concurrent reservation tests |
| PR-008 | Groups/agents/missions form a validated finite task DAG with leases, retries and durable events | 03; race, crash, reconciliation tests |
| PR-009 | Pause, resume, cancel and latched emergency stop work at instance/org/environment/mission scope | 03–06; partition and restart tests |
| PR-010 | Two bots connect to a private compatible Java test server and complete a bounded build | 04, 06; world-state verifier |
| PR-011 | Dashboard includes onboarding, fleet, mission details, live progress and role-aware settings | 05; browser journeys |
| PR-012 | Child launches an approved Minecraft preset through world → army → preset and cannot escape policy | 05–06; positive and negative child journeys |
| PR-013 | Minecraft cooperation handles resources, shared chests, reservations and recoverable world drift | 06; multi-bot fixtures |
| PR-014 | Gemini, OpenAI, Anthropic and configured compatible endpoints are optional adapters, disabled by default | 07; common provider contract suite |
| PR-015 | Coding team outputs a reviewable patch and test evidence from isolated workspaces | 08; sandbox and approval tests |
| PR-016 | Research team outputs a dated Markdown report with supported claims and citations | 08; source/claim evaluation |
| PR-017 | CLI and REST API share authorization, typed contracts and safe machine-readable errors | 00, 03, 09; CLI/API parity tests |
| PR-018 | Backups, restore, health, monitoring, upgrades, images and fresh-install documentation are usable | 09; clean-host and restore exercises |
| PR-019 | Core and Cloud have explicit boundaries; hybrid runner is optional and outbound-connected | 10; architecture review |
| PR-020 | Optional commercial Cloud includes BYOK isolation, hosting subscriptions, metering and abuse controls | 11 only; separate repository gates |
| PR-021 | Audit history records actor, policy decision and state changes without raw secrets or private prompt logs by default | 01 onward; redaction and audit atomicity |
| PR-022 | Extension authors receive examples, contracts, documented errors and compatibility policy | 07–09; third-party adapter fixture |
| PR-023 | Inventory/preserve the existing deployment; adoption binds it in place read-only without start/recreate/migration/world or unrelated-workload changes | F0–F1; MC-02/11 |
| PR-024 | Multi-server registry and private capability-based observation adapter expose status/players/freshness and security gaps without bots/models | F1; MC-02/12 |
| PR-025 | Management mutations return durable operation IDs; current scoped permissions, UUID idempotency, atomic audit/outbox, leases/fences and uncertain-effect reconciliation apply at every surface | F1–F3; MC-01/06 |
| PR-026 | Verify Java UUID and Bedrock/Floodgate immutable identity/provenance; online auth and strict allowlists deny unknown/spoofed identities without an onboarding join window | F2; MC-03 |
| PR-027 | Adult-only desired/actual player access shows pending/applied/failed/drifted; verified revoke/expiry, separate kick, no implicit OP or web/game identity equivalence | F2; MC-04 |
| PR-028 | Private management plane only: no public RCON/Docker/DB/Redis/node listener; no socket/RCON secrets in API/web/MCP/bot workers; TLS/private access and remote privileged MFA | F0–F3; MC-05/10 |
| PR-029 | Daily consistent encrypted backups, ≥14-day retention, weekly off-host copy, separate keys, disk/health alerts and successful isolated restore; approved staged restore protects original world | F2; MC-08 |
| PR-030 | One-use expiring node enrollment, outbound mTLS, rotation/revocation and signed expiring target-bound jobs; no arbitrary shell/RCON/Docker passthrough or caller-selected host paths | F2.5; MC-06/10 |
| PR-031 | Adult-approved template dry-run/EULA, pinned vetted image/plugins, CPU/RAM/disk quotas, capacity/ports across all workloads, reserved resources and private networking before provision | F2.5; MC-07 |
| PR-032 | Idempotent deployment/readiness/crash reconciliation and ownership-proven rollback; retain worlds/backups, preserve manual stops; approved update/restore never assume image downgrade undoes world changes | F2.5–F3; MC-09/11 |
| PR-033 | REST/UI/MCP share domain policy, audit and operations; secured Streamable HTTP validates OAuth audience/resource/scopes; human approval for machine provisioning; high-risk automatic tools disabled | F2.5–F3; MC-01/10 |
| PR-034 | Typed start/stop/restart, redacted bounded logs/metrics, staged updates and retained decommission across scoped servers; adopted lifecycle enabled only by explicit approval | F3; MC-11 |
| PR-035 | Mobile/keyboard parent dashboard supports observation then verified access/backups/audit with providers absent; child has assigned safe views only, no infrastructure/access/backup administration | F1–F2; MC-12 |

## Release scope

First management previews: F1 observation-only dashboard, then F2 family-ready access/backups after applicable [acceptance gates](../testing/minecraft-management.md). Lifecycle arrives in F3, after F2.5 secure provisioning. No feature is Contabo-ready without explicit authorized preflight/remediation and real evidence. See [ADR 0015](../architecture/decisions/0015-unified-control-plane.md) and [track](../delivery/minecraft-track.md).

Preserved agent vertical slice (M2), after the management track: local accounts, tenant boundaries, provider policy, scheduler, Minecraft connection, adult dashboard, child presets, cooperative small build, Stop All. Use a 5×5 shelter fixture with explicit terrain/material requirements; distinguish prepared-world cooperation from later survival gathering.

Core v0.1 candidate (M4): all Core chapters 00–09 and applicable F-track gates accepted, including coding/research examples, install/restore/upgrade documentation, CLI, provider contracts and security gates. Shipping a smaller Minecraft-only preview is allowed if clearly labeled and documented in a new scope decision. It must not be advertised as the full Core release.

Excluded until separately designed: arbitrary plugin uploads, Kubernetes requirement, unrestricted internet agents, public child signup, payments in Core, provider token resale, public Minecraft servers by default, SSO as a local-auth replacement, autonomous production deployment, multi-region HA, general-purpose distributed consensus, and unbounded multi-agent chat.

## Nonfunctional targets

All numbers below are initial acceptance targets, not measured capabilities or service guarantees. Chapter 00 establishes a repeatable benchmark recipe; later chapters replace assumptions with measured data.

| ID | Target | Measurement |
| --- | --- | --- |
| NFR-01 | API p95 under 500 ms for ordinary authenticated reads at 5 concurrent local users | Warm stack, 30-minute run; exclude model/Minecraft latency |
| NFR-02 | Committed events visible in dashboard within 2 s p95 on LAN | API event timestamp to browser receipt; server clock reference |
| NFR-03 | Connected-worker emergency stop acknowledged within 2 s p95; no new dispatch after stop commit | Fault-injection action timestamps; independent lease deadline bound |
| NFR-04 | Reference action lease 15 s, heartbeat 5 s, maximum isolated-worker action window 20 s including grace | Fake-clock tests; tune only with documented risk review |
| NFR-05 | No duplicate committed task result during 100 concurrent claim/replay attempts | Database uniqueness plus stale-fence tests |
| NFR-06 | Prepared-world two-bot shelter succeeds in 3 consecutive seeded runs within 10 min each | Exact world/server/adapter versions and block assertions |
| NFR-07 | Backup target RPO 24 h / RTO 60 min for a small self-hosted installation | Restore drill on reference dataset; report actual results |
| NFR-08 | Keyboard usable UI, meaningful focus, contrast and announced live status aligned with WCAG 2.2 AA | Automated checks plus manual keyboard/screen-reader review |
| NFR-09 | No external requests during default CI except dependency/image retrieval in controlled setup | Network deny logs in actual test processes |
| NFR-10 | Bounded CPU/RAM/storage and event retention; 2–3 bots measured on reference host | Resource profiles, 1-hour soak, evidence and bottleneck report |

Minecraft private server hosting, provider inference, and hardware availability are deployment prerequisites; the product cannot guarantee external services or eliminate electricity/infrastructure costs. “Free-only” means zero eligible provider inference price, not zero operating cost.

## Success evidence

Record environment, versions, seed, policy configuration, anonymized event trace, verifier output and Stop All measurement. Demonstrations alone do not prove tenant isolation, restart recovery or budget correctness; those require automated negative tests. Keep all product tests mapped to PR/NFR IDs in [the testing plan](../testing/strategy.md).

CL-F25-01/A–B implements the read-only portion of PR-030: adult-approved, certificate/key-bound enrollment, rotation/revocation, private signed heartbeat and Hosts UI. Actual local inventory/reconnect evidence does not satisfy signed physical commands, broker quotas, provisioning, F2 player controls/backups or production qualification. No release gate is relaxed by parallel local development.

CL-F25-02/A adds a strict Family Survival template and effect-free placement preview for PR-031. It checks current adult `node:deploy`/`server:provision`, canonical same-project Minecraft scope, report freshness, declared memory and Docker port conflicts. Pinned unqualified artifacts, EULA false and open image/identity/recovery/storage/network/broker gates prevent dispatch; preview never creates a reservation or approval.

PR-030 local signed execution primitives now exist at CL-F25-01/C. Fake authority/broker and process-kill evidence prove local ordering/replay/stop refusal, not production command dispatch, actual Docker fencing, Minecraft readiness or verified recovery.

PR-031 reservation primitives now have real PostgreSQL race/tenant/current-authority evidence at CL-F25-02/B. This proves controller metadata exclusion, not physical quotas, full host qualification or Minecraft provisioning; production admission/approval and broker remain unimplemented.

CL-F25-02/C implements fixed private image/resource/mount/network policy and selected Engine methods for PR-030–032. Recording fixtures prove protocol/policy negatives only; public dispatch, ownership recovery, real persistent quota and Minecraft/restore qualification remain gated.

CL-F25-02/D local evidence adds creation-proven journal ownership, no blind retry after unknown writes, manually stopped state preservation and evidence-bearing rolled-back outcomes distinct from success. World/backups/allocated reservations remain retained after runtime compensation. Real Minecraft/recovery/host release requirements remain unverified.

CL-F25-03/A implements the durable intake portion of PR-028/032 only: current scoped adult request, exact immutable allocation/dispatch binding, atomic audit/outbox and idempotent pending metadata. SQL/contracts force execution disabled; no server-provisioning completion, world readiness or later release requirement is considered met.

CL-F25-03/B adds local durable command/lease/current-permit/receipt evidence for PR-028/032. First provision is attempt/fence 1, one command per intake and no automatic retry; its success is stopped resources, not playable readiness. Unknown/expired or late receipts retain uncertainty and world/port accounting. Real transport/host/approval/identity/recovery release requirements remain unmet.

CL-F25-03/E adds private delegated-authority intake/issuer separation for PR-028/032: no API control signing key, no gateway identity DB secret, no grants in projections/outbox, exact immutable original scope/stop/expiry and no authority renewal by replay. This is permission delegation metadata, not independent approval/EULA acceptance or a completed provisioning milestone.

CL-F25-03/K1 supplies a private two-adult current-authority prerequisite for PR-003/025/031/033. Local identity/concurrency evidence does not complete durable independent approval, provision a server or satisfy any host/game/recovery release gate.

CL-F25-03/P1 / ADR 0031 prioritizes a separately operated owner-playable VPS preview before completing platform provisioning automation. It preserves PR-023/026/028/029/031/032 safety requirements and does not claim their full release acceptance. The prepared Java-only bundle cannot verify identities, enforce host disk quota, back up/restore, provision through CraftLayer or qualify Bedrock by itself; those actual target/game gates remain pending.
