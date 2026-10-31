# Risks, assumptions and unresolved decisions

Status: open planning register, 2026-10-31. Owners below are proposed responsibilities, not named people or completed reviews. Defaults let engineering proceed safely within an authorized chapter; they do not imply user approval for commercial or irreversible actions.

## Decisions to resolve

| ID | Decision | Working default | Resolve by / responsible role | Evidence required |
| --- | --- | --- | --- | --- |
| D-01 | Core license | Apache-2.0 candidate; no license file adopted | Before public release / project owner | Explicit license choice and dependency compatibility review |
| D-02 | Runtime/framework/image versions | Resolved for foundation: ADR 0011 and compatibility matrix; release review still required | 00 / lead engineer | Compatibility matrix, clean build and host checks |
| D-03 | Reference host capacity | Small private host, 2 bots, inference optional/remote | 00 baseline; 06/09 qualification / operator | CPU/RAM/storage/latency results and exact hardware |
| D-04 | Auth/hash/session libraries | Resolved for Chapter 01: Argon2id 2.2.2 binding, opaque sessions and versioned authority; ADR 0012/review | 01 / security engineer | Maintenance review, secure config and measured hashing |
| D-05 | Owner recovery/email behavior | Resolved for Chapter 01: identity-only hidden/stdin local recovery; TLS SMTP optional, tests use fakes | 01 / auth engineer | Safe reset without token leakage or Cloud |
| D-06 | Credential master-key storage | Local protected key file/secret reference, versioned encryption | 02 / security/operator | Rotation, wrong-org decrypt denial and separate-key restore |
| D-07 | Strict free-only provider assurance | Ineligible if billing behavior cannot be bounded | 02/07 / provider engineer | Official pricing/feature/endpoint behavior plus negative contracts |
| D-08 | Model selection and catalog TTL | No permanent free-model list; proposed 5-min hosted TTL | 02 / provider engineer | Freshness/outage tests and explicit metadata limits |
| D-09 | Minecraft versions and bot login | Private Java server; supported legitimate auth path | 04 / adapter engineer | Connect/reconnect proof, account/license/network prerequisites |
| D-10 | Minecraft fixture terrain and materials | Seeded flat approved region; prepared supply before survival | 04/06 / adapter engineer | Reproducible world and BOM/verifier |
| D-11 | Sandbox implementation | Narrow broker; restricted local runner, hosted isolation separately reviewed | 08 / security/runtime engineer | Egress/process/filesystem/isolation tests on supported platform |
| D-12 | Telemetry and error collection | Foundation implemented: disabled Next telemetry, local redacted logs and network-disabled tests; full monitoring remains 09 | 00/09 / operator | Network deny and log-secret tests |
| D-13 | Retention defaults | Events 7d, audit 90d, artifacts 30d; configurable | 01/08/09 / owner/operator | Privacy/resource review and purge/backup behavior |
| D-14 | First release scope | Full Core 00–09; earlier Minecraft preview labeled separately | Before preview/release / owner | Written scope ADR, feature matrix and evidence |
| D-15 | GitHub ownership/visibility | User creates empty craftlayer repository | Resolved: coldbathcode/craftlayer, standing build-step push authorization / owner | Remote and commits verified in Git |
| D-16 | Domains and trademark | Working name only; availability not verified | Before launch / owner | Registrar/trademark review; no claim from this plan |
| D-17 | Security disclosure and maintainers | No fabricated email/maintainers | 09 / owner | Monitored channel, response ownership and policy |
| D-18 | Cloud isolation and identity | Separate tenant service; no shared-process hostile jobs | 10 / Cloud lead | Tenant/runner threat model and reviewed architecture |
| D-19 | Cloud billing/terms/prices | BYOK hosting fees, prices TBD; no token resale | 10 before 11 / owner/commercial reviewer | Measured costs, provider terms and subscription risk review |
| D-20 | Hybrid private runner scope | Optional outbound-only beta after separate scope decision | 10/11 / runtime/security lead | Enrollment/revocation/partition proof and local policy ceiling |
| D-21 | Timeline/staffing | No promised dates; M/L sizes are complexity estimates | After 00/04/08 spikes / project owner | Measured throughput and critical-path reassessment |
| D-22 | Stop/action lease tuning | 5s heartbeat, 15s lease, 20s isolated-action bound target | 03/04/09 / runtime lead | Partition/physical-stop tests on reference hardware |
| D-23 | Identity snapshot/audit scope | ADR 0012: bounded 100-row lists; correlation, cursor navigation, global audit UI and retention deferred | 03/05/09 / runtime and operations | Preserve authorization and redact projections while extending operability |

## Engineering risk register

| Risk | Impact / likelihood assumption | Mitigation | Trigger / fallback |
| --- | --- | --- | --- |
| Free hosted models disappear or 429 frequently | High / likely | Eligible local inference, deterministic tasks, clear block reasons | Pause/queue; never enable paid fallback automatically |
| Provider metadata cannot bound invoice | High / plausible | Reject unsupported strict paths; document provider-side controls | Keep model ineligible and use local route |
| N150-class host cannot run world + inference smoothly | Medium / plausible | Measure small model/bots; inference on separate host | Reduce bots/model or document hardware requirement |
| Minecraft protocol/auth churn | High / plausible | Pin compatibility set and contract world | Hold upgrade; keep prior supported image |
| Duplicate physical action after partition | High / plausible | Single bot session, watchdog, receipts/preconditions and reconciliation | Block uncertain task for adult/operator review |
| Tenant leak through events/artifacts or pool context | Critical / plausible | Full-surface negative suite and non-owner RLS | Stop affected feature; fix before release |
| Child escapes preset/account ceiling | Critical / plausible | Account ceiling plus API/worker enforcement and adversarial routes | Revoke access and block release |
| Coding runner compromises host/peer tenant | Critical / plausible | Restricted broker, no ambient secrets, stronger hosted isolation | Disable coding adapter until reviewed |
| Research hallucinates claims or fetches internal services | High / likely without controls | Source/claim ledger, deterministic citation checks, controlled egress | Mark unsupported source/claim or deny fetch |
| Backup exists but keys/world/DB inconsistent | High / plausible | Coordinated snapshots, separate key recovery and clean restore drills | Remain stopped; use known-good full backup |
| Migration prevents safe downgrade | High / plausible | Expand-contract, compatibility matrix and coordinated restore | Forward repair or tested restore, not blind image downgrade |
| Cloud work delays useful Core | Medium / plausible | Explicit M4 gate and separate repo/authorization | Defer Cloud design/implementation |
| Unbounded events/blackboard exhaust storage | Medium / likely | TTL/byte limits, cursor pagination, retention and monitoring | Pause ingestion/mission safely; retain essential audit/ledger |
| Plan diverges from implementation across sessions | Medium / likely | Stable IDs, chapter review, status/handoff and ADR changes | Reconcile docs/code before next gate |

## Decision workflow

For a new material question: assign ID, describe impact, propose the safest useful default, record alternatives/evidence and identify the chapter gate. Ask the user only when the answer materially changes authorized product scope or requires an external/irreversible action; routine local engineering choices can be resolved with documented rationale. Update ADRs and affected tests/specifications after a decision.

An open question does not block unrelated planning. Never resolve a high-risk unknown by inventing a tested fact or silently weakening the acceptance criteria.
