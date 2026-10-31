# Product requirements and traceable outcomes

Status: proposed implementation specification. Source: [blueprint v0.2](../source/CraftLayer_Build_Blueprint.md). Requirement IDs are stable and referenced by chapters and acceptance tests.

## Product purpose

A family can deploy a private instance, create safe accounts, select a Minecraft world and army, launch an approved mission, and watch coordinated progress. A developer can use their own models and implement adapters. A future managed service can host Core without making self-hosted users migrate.

The first demonstrable outcome is a bounded small Minecraft structure completed by two bots, with visible progress and a reliable stop control. A fully autonomous open-ended civilization is outside the first release.

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

## Release scope

First vertical slice (M2): local accounts, tenant boundaries, provider policy, scheduler, Minecraft connection, adult dashboard, child presets, cooperative small build, Stop All. Use a 5×5 shelter fixture with explicit terrain/material requirements; distinguish prepared-world cooperation from later survival gathering.

Core v0.1 candidate (M4): all Core chapters 00–09 accepted, including coding/research examples, install/restore/upgrade documentation, CLI, provider contracts and security gates. Shipping a smaller Minecraft-only preview is allowed if clearly labeled and documented in a new scope decision. It must not be advertised as the full Core release.

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
