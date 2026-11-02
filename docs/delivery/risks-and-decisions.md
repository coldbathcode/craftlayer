# Risks, assumptions and unresolved decisions

Status: reconciled through CL-03-06 and REC-01 documentation, 2026-11-02. Owners below are proposed responsibilities, not named people or completed reviews. Defaults let engineering proceed safely within an authorized chapter; they do not imply user approval for commercial or irreversible actions.

## Decisions to resolve

| ID | Decision | Working default | Resolve by / responsible role | Evidence required |
| --- | --- | --- | --- | --- |
| D-01 | Core license | Apache-2.0 candidate; no license file adopted | Before public release / project owner | Explicit license choice and dependency compatibility review |
| D-02 | Runtime/framework/image versions | Resolved for foundation: ADR 0011 and compatibility matrix; release review still required | 00 / lead engineer | Compatibility matrix, clean build and host checks |
| D-03 | Reference host capacity | Small private host, 2 bots, inference optional/remote | 00 baseline; 06/09 qualification / operator | CPU/RAM/storage/latency results and exact hardware |
| D-04 | Auth/hash/session libraries | Resolved for Chapter 01: Argon2id 2.2.2 binding, opaque sessions and versioned authority; ADR 0012/review | 01 / security engineer | Maintenance review, secure config and measured hashing |
| D-05 | Owner recovery/email behavior | Resolved for Chapter 01: identity-only hidden/stdin local recovery; TLS SMTP optional, tests use fakes | 01 / auth engineer | Safe reset without token leakage or Cloud |
| D-06 | Credential master-key storage | ADR 0013: protected versioned key file and org-bound AES-GCM; rotation qualified in Chapter 02, coordinated restore pending | 02/09 / security/operator | Isolated rotation and wrong-org denial; separate-key restore remains unverified |
| D-07 | Strict free-only provider assurance | ADR 0013: OpenRouter strict zero-cost enforcement remains unproved and ineligible; exact operator-local Ollama only with cloud disabled | 02/07 / provider engineer | Official pricing/feature/endpoint behavior plus negative contracts |
| D-08 | Model selection and catalog TTL | Resolved: explicit approved IDs, maximum 5-min freshness, unknown capabilities/prices denied | 02 / provider engineer | Freshness/outage tests and explicit metadata limits |
| D-09 | Minecraft versions and bot login | Private Java server; supported legitimate auth path | 04 / adapter engineer | Connect/reconnect proof, account/license/network prerequisites |
| D-10 | Minecraft fixture terrain and materials | Seeded flat approved region; prepared supply before survival | 04/06 / adapter engineer | Reproducible world and BOM/verifier |
| D-11 | Sandbox implementation | Narrow broker; restricted local runner, hosted isolation separately reviewed | 08 / security/runtime engineer | Egress/process/filesystem/isolation tests on supported platform |
| D-12 | Telemetry and error collection | Foundation implemented: disabled Next telemetry, local redacted logs and network-disabled tests; full monitoring remains 09 | 00/09 / operator | Network deny and log-secret tests |
| D-13 | Retention defaults | Events 7d, audit 90d, artifacts 30d; configurable | 01/08/09 / owner/operator | Privacy/resource review and purge/backup behavior |
| D-14 | First release scope | ADR 0015: F1 observation preview, F2 access/backup family gate, F3 lifecycle; full Core 00–09 + applicable F gates | Before preview/release / owner | Written scope ADR, feature matrix and evidence |
| D-15 | GitHub ownership/visibility | User creates empty craftlayer repository | Resolved: coldbathcode/craftlayer, standing build-step push authorization / owner | Remote and commits verified in Git |
| D-16 | Domains and trademark | Working name only; availability not verified | Before launch / owner | Registrar/trademark review; no claim from this plan |
| D-17 | Security disclosure and maintainers | No fabricated email/maintainers | 09 / owner | Monitored channel, response ownership and policy |
| D-18 | Cloud isolation and identity | Separate tenant service; no shared-process hostile jobs | 10 / Cloud lead | Tenant/runner threat model and reviewed architecture |
| D-19 | Cloud billing/terms/prices | BYOK hosting fees, prices TBD; no token resale | 10 before 11 / owner/commercial reviewer | Measured costs, provider terms and subscription risk review |
| D-20 | Hybrid private runner scope | Optional outbound-only beta after separate scope decision | 10/11 / runtime/security lead | Enrollment/revocation/partition proof and local policy ceiling |
| D-21 | Timeline/staffing | No promised dates; M/L sizes are complexity estimates | After 00/04/08 spikes / project owner | Measured throughput and critical-path reassessment |
| D-22 | Stop/action lease tuning | 5s heartbeat, 15s lease, 20s isolated-action bound target | 03/04/09 / runtime lead | Partition/physical-stop tests on reference hardware |
| D-23 | Identity snapshot/audit scope | ADR 0012: bounded 100-row lists; correlation, cursor navigation, global audit UI and retention deferred | 03/05/09 / runtime and operations | Preserve authorization and redact projections while extending operability |

| D-24 | Provider runtime and operability boundary | ADR 0013: canonical mission/task/lease/outcome plumbing starts 03; reports bounded to 100, retention/restore in 09 | 03/05/09 / runtime/operator | Replay-safe outcomes, canonical scope, complete key inventory, cursor reports and restore drills |

| D-25 | Runtime scope and worker authority | ADR 0014: explicit adult-only simulation, trusted API coordinator, org/environment-bound workers, persisted fence/stop and bounded SSE | 03 / runtime/security | Claim/replay races, current authority, queue tampering, partition watchdog and event isolation |

## Unified management decisions

| ID | Decision | Working default | Resolve by / responsible role | Evidence required |
| --- | --- | --- | --- | --- |
| D-26 | Paper/Geyser/Floodgate identity compatibility | Inspect actual pinned versions; verified immutable UUID/XUID provenance, unresolved identity pending, no auth/allowlist-off bypass | F0 inventory/F2 / adapter-security engineer | Real Java/Bedrock denial/admission/rename/revoke and safe first-time enrollment |
| D-27 | Remote privileged entry and MFA | Private HTTPS, MFA covering every privileged path, direct origin blocked; local accounts/recovery stay standalone | F1 before remote use / operator-security | UI/REST/SSE and later MCP access/expiry/MFA/bypass tests; chosen optional proxy recipe |
| D-28 | Consistent backups, keys and off-host target | Daily ≥14d, weekly encrypted off-host, separate protected keys; no destination transfer without approval | F0 plan/F2 / operator | Actual save behavior, disk/headroom, retention/failure and isolated restore; RPO/RTO measured |
| D-29 | Node isolation, signing and enforceable disk quotas | ADR 0016: dedicated/rootless where compatible, outbound mTLS + signed expiring jobs; deny unsupported hard storage limits | F2.5 / node-security engineer | Privilege review, local replay journal, rotate/revoke, resource/port/mount and crash proofs |
| D-30 | Independent approval availability | Preserve existing no-self-approval semantics; second authorized adult required for high-risk jobs; surface unavailable actions | F2/F25 / owner-security | Requester/agent cannot self-approve; changed plan/policy/target expires approval. No single-parent bypass inferred |
| D-31 | Unified naming and repo sketches | ADR 0015/management architecture canonical colon permissions, routes/tool names; preserve existing package/API names | F1/F25 / lead engineer | Schema/SDK compatibility, no duplicate auth/audit/runtime, documented backup alias shares operation identity |
| D-32 | Delivery versus production authority | F phases planned only; existing CL-03-07 authorization persists; Contabo read/backup/write separate | Every boundary / operator-owner | Exact task/host authorization and environment-specific acceptance; no prompt-as-approval |

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

## Minecraft preservation and infrastructure risks

| Risk | Impact / likelihood assumption | Mitigation / gate |
| --- | --- | --- |
| Historical Contabo paths/state/backup assumptions wrong | Critical / plausible | Approved read-only inventory; unknown blocks readiness; never start/recreate to discover |
| Read-only access mistaken for backup/save or deployment approval | Critical / plausible | Distinct approval scopes in preservation runbook; scripts make no mutation by default |
| Floodgate identity spoof/name/link drift | Critical / plausible | D-26, pinned real-client gate, immutable provenance, fail closed |
| Docker agent compromise affects unrelated host services | Critical / plausible | Dedicated host where possible, typed broker + local policy, no socket in apps; document host-level residual risk |
| Save-off stranded after backup crash or last good backup pruned | Critical / plausible | Bounded save-on cleanup/watchdog, protected verified sets, failure injection and off-host isolated restore |
| Port/capacity race or unsafe cleanup destroys existing world | Critical / plausible | Transactional reservations + host recheck, immutable ownership journal, retain all data volumes, fault/preservation suite |
| Private-entry proxy leaves REST/SSE/MCP bypass or no MFA | Critical / plausible | Test every route/direct origin, keep remote access unavailable until D-27 proof |
| Parent dashboard falsely declares family-ready from fakes | High / plausible | Real client/restore/network gates; F1 observation and F2/F3 capability labels distinct |
| High-risk workflow unusable for one adult | Medium / plausible | D-30 explicit availability limit; no weakening of independent approval without separately reviewed scope change |

## Decision workflow

For a new material question: assign ID, describe impact, propose the safest useful default, record alternatives/evidence and identify the chapter gate. Ask the user only when the answer materially changes authorized product scope or requires an external/irreversible action; routine local engineering choices can be resolved with documented rationale. Update ADRs and affected tests/specifications after a decision.

An open question does not block unrelated planning. Never resolve a high-risk unknown by inventing a tested fact or silently weakening the acceptance criteria.

Chapter 02 authorization: the user requested “keep going next steps” after the Chapter 01 review. Chapter 03 was subsequently authorized by the next-steps request; Chapter 04 remains gated. ADR 0013 also resolves the entry-gate overstatement: only the recovery encryption pattern existed before Chapter 02; provider credential storage is implemented in its own task.

## F0 local preflight checkpoint

CL-F0-01 uses no new runtime dependency: pinned TypeScript/tsx, fixed no-shell local reads, size/time caps and allowlisted output/fingerprints. Server/plugin/Java versions, ownership, actual client identity enforcement, effective network isolation and backup recovery remain unverified (D-26–D-29). Local fixture proof does not resolve production risks or authorize host access. Five existing runtime/test edits were preserved. Next: CL-F0-02 stable preservation evidence and disposable recovery rehearsal.

## F0 local review

CL-F0-02 adds stopped-source fingerprints with bounded chunked hashing and ordinary concurrent-change detection; this is not an atomic snapshot or protection from a malicious host. Synthetic filesystem-copy recovery and corruption/loss/link/mode/binding tests qualify local comparison only. Backup creation, encryption/key recovery, off-host copies, playable world restore, Java/Bedrock identities, edge reachability and Contabo state remain open. Conservative 2 GiB tree/512 MiB file/10,000-entry/depth-16 limits can refuse large real worlds; scope expansion requires explicit reviewed implementation, not silent truncation. F1 remains gated; the conditional remediation guide contains no automatic repair action.

F1/CL-F1-01: ADR 0017 resolves cross-pool session FK blocking by recording canonical session identity without a global identity FK; current guards remain mandatory. Explicit new read grants prevent broadening old environment assignments. Existing-role upgrade and temporary-policy removal are tested. Captured/live adapter, HTTP, UI and remote-entry qualification remain next tasks, not implied by domain tests.

CL-F1-02: status queries cannot prove identity/allowlist/RCON privacy, list every player or start a stopped server; only operator-approved private literals and fixed packets are supported. Captures age visibly. Remote management now fails closed until MFA/private entry is qualified; a local preview is the supported scope. Retention ceiling is 10,000 operations/environment with twelve actor/environment writes/minute; later retention/large-installation work remains open.

CL-F1-03: `/servers` labels captured settings, stale data and unverified identity/recovery explicitly; combined allowlist flags avoid a false configured badge. Child and scoped viewer behavior, organization-switch cache clearing and expired sessions have disposable browser coverage. Source failure preserves the last stored snapshot. No high-risk/game controls or models are exposed. Local desktop/mobile/focus checks do not qualify screen-reader/real-family usability, private HTTPS/MFA or public edge isolation. F1 local review is prepared; D-26–D-29 and actual identity/restoration remain open for F2 and approved live work.

F2/CL-F2-01 checkpoint A: user authorized local F2 after the F1 review. ADR 0018 makes Java/Bedrock issuer/subject distinction and link-change review explicit. Candidate artifacts are pinned and hash-checked but Geyser/Floodgate descriptors are snapshots; real compatibility/security suitability and approved licensed clients remain unresolved. Artifact preparation is non-runnable and leaves EULA false. No authenticated bridge, player admission, account ownership/binding, policy write or existing-world migration is inferred. D-26/MC-03 remain open; CL-F2-02 is gated on actual identity proof.

CL-F2-01 checkpoint B / runnable prototype: pending name requests persist with false verification/access; immutable SQL cannot be promoted or rebound through runtime. New `player:enroll` defaults to adult admin only. Separate loopback prototype and flagged synthetic captures make UX testing possible without connecting a game. Retention limits (200 requests/server, 24h request expiry, no purge) remain preview constraints. Real bridge/ownership binding, MC-03 and F2 access/recovery gates remain open; a successful “saved” operation is not verified enrollment or admission.

CL-F25-01/A: user-authorized parallel node development (ADR 0019) does not waive F2 release/production gates. mTLS plus certificate/key/control/sequence binding narrows enrollment and replay; CA issuance/private trust, private remote reachability, certificate operational rotation and actual host security remain operator qualification. Initial inventory has no effect verbs and cannot claim full host capacity/OS port/quota or provisioning readiness. Docker socket access remains host privilege; no socket wrapper or bind-read-only claim substitutes for isolation. Unclean journal locks require controlled recovery; automatic reconnect, mutable leases/fences and broker policy remain next gates.

CL-F25-01/B: real local Docker inventory and gateway stop/start reconciliation now work without effects; connection retries retain sequence. An issuance rollover defect was found/corrected by a single-sample 30s clock window. Agent reads use absolute deadlines against slow streams. Local client renewal is explicit and cannot extend an expired enrollment or CA. Production PKI/installer/private edge/MFA, native port inventory, hard quota qualification and physical commands/leases/fences remain open. Socket compromise is still host compromise; no isolation claim is added.

CL-F25-02/A: a deployment preview is not approval, reservation or verified free capacity. Digest/time/scope binding and strict fields narrow caller choices, but only future signed/revalidated jobs may create effects. Complete Minecraft image, actual Java/Bedrock access, native host conflicts, storage quotas, independent approval and backup restoration remain unqualified. Docker-only reports cannot unlock dispatch. New permissions are additive/admin-only; no cloud, socket exposure or world writes are added.
