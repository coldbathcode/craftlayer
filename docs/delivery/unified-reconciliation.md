# Unified specification reconciliation — REC-01

Date: 2026-11-02. Scope: documentation reconciliation only. Baseline: `403e474` on main; this report is based on repository inspection, not a rerun of chapter acceptance suites. Inputs: [unified v0.4](../CRAFTLAYER_UNIFIED_SPEC.md), [build prompt](../BUILD_PROMPT.md), unchanged [blueprint v0.2](../source/CraftLayer_Build_Blueprint.md), [AGENTS.md](../../AGENTS.md).

## Chapter inspection and reuse

| Chapter | Observed implementation | Recorded verification | Remaining work / reuse limit |
| --- | --- | --- | --- |
| 00 | Workspace/lockfile, private `docker-compose.yml`, Fastify/Next shells, Drizzle + SQL migration runner, restricted DB roles, CI and boundary checker | Seven tasks verified; [review](../reviews/00-foundation.md) | Preserve services, volumes and pins. No new skeleton or ORM. Production hosting not qualified |
| 01 | `packages/auth`, `packages/core/src/access.ts` and `permissions.ts`; migrations 0001–0004; account console, sessions/CSRF, child ceiling, grants, recovery, append-only audit | Seven tasks verified; [review](../reviews/01-identity-and-rbac.md); accepted for advancement | No Minecraft-specific permissions, MFA, OIDC, scoped machine credentials or complete cursor audit API yet |
| 02 | `packages/providers`; migrations 0005–0007; encrypted credentials, endpoint policy, free-only router, durable ledger/stop | Seven tasks verified; [review](../reviews/02-provider-gateway.md); accepted for advancement | Keep optional and independent of management. Key-storage pattern can inform management secrets; do not reuse provider credentials or encryption purposes |
| 03 | `packages/runtime`, pure core graph rules, runtime contracts/SDK/CLI, API coordinator and bearer-only workers; migrations 0008–0015; outbox, leases/fences, stops, approvals, recovery, bounded SSE | CL-03-01–06 recorded verified; latest record 198 unit and 85 database/API cases; [build log](build-log.md) | CL-03-07 actual Redis/container restart drill and final chapter review remain open. Simulation-only registry and mission approvals are not infrastructure authority |

Evidence locations inspected: `apps/api/src/{app,auth-routes,provider-routes,runtime-routes,runtime-streams}.ts`, `apps/web/src/app/account`, `apps/worker/src/main.ts`, `packages/{auth,core,contracts,db,providers,runtime,sdk}`, migrations and tests. `apps/api/src/app.ts` wires identity/provider/runtime only. There is no Minecraft control/node service, server/player/backup/operation registry, Docker provisioning implementation or MCP app. Environment metadata is not adoption. The SDK is typed and schema-validated; complete generated endpoint coverage and OpenAPI 3.1 qualification remain work.

Five pre-existing modified files were present at entry: runtime `events.ts`, `models.ts`, `scripts/check-local-secrets.mjs`, `scripts/test-runtime-stack.mjs`, and `tests/integration/auth.integration.test.ts`. They appear related to ongoing runtime qualification but are not committed evidence. Preserve them and exclude them from REC-01 publication; do not mark CL-03-07 passed from their presence.

## Gaps and derived contract changes

| Unified requirement | Existing reusable base | New owning work |
| --- | --- | --- |
| Preserve/inventory Contabo; no silent start | Private Compose conventions and disposable test harnesses | F0 redacting preflight, world/container fingerprint, explicit production access gate |
| In-place read-only adoption and parent dashboard | Identity, world/project scopes, account UI/SDK | F1 server registry, capability-based private adapter, freshness/status/player views |
| Java/Bedrock identity and allowlists | Adult accounts, child denial, audit | F2 verified UUID/XUID provenance, version-specific Floodgate integration, desired/actual access and expiry |
| Daily consistent backup and successful restore | Migration discipline and secret-file patterns | F2 world/config/plugin archive, separate key recovery, off-host copy, isolated restore, health |
| Durable management operations | Runtime transaction/outbox/idempotency/lease patterns | F1 separate operation aggregate; F2 effects/approval/reconciliation. No mission or LLM prerequisite |
| Secure Docker placement/provisioning | Worker-bound authority and fixed protocol patterns | F2.5 distinct privileged node principal, one-use enrollment/mTLS/signed jobs, local broker, quotas/reservations and ownership-safe rollback |
| Multi-server lifecycle/observability | Scoped API, streams and audit patterns | F3 constrained lifecycle, approved updates/decommission, bounded metrics/logs |
| MCP management | Public contracts, policy services | F2.5 scoped subset and separate OAuth-qualified transport; no prompt-as-approval; broader tools F3 |
| Remote privileged login | Local session/CSRF controls | F1 deployment gate for MFA on every privileged entry path, TLS/private access; optional external identity must not become Core dependency |
| Bots, armies and other environments | Completed runtime/provider work | Preserve CL-04–09 IDs; reuse approved management fixtures/UI later; do not rebuild Chapters 00–03 |

## Conflicts and resolutions

1. Embedded build prompts say start F0 scripts/F1 skeleton; original source says start Chapter 00. The current user explicitly authorizes documentation only. No script, service or VPS operation is authorized by reading these inputs. Chapter 03 authorization persists; F chapters and Chapter 04 need separate approval.
2. The old roadmap made a bot build the first outcome and deferred all dashboard/backup work to 05/09. [ADR 0015](../architecture/decisions/0015-unified-control-plane.md) inserts F0 → F1 → F2 → F2.5 → F3 before new bot work, preserving all existing IDs and chapter evidence. F1 depends on identity, not agent runtime completion. Already authorized CL-03-07 may finish without adding new agent features.
3. The input repository/package diagrams are illustrative. Keep `packages/runtime`, `packages/providers`, the existing auth/core/audit ownership, SDK and root Compose. Add only needed management modules at their authorized task; no renaming or second identity/control plane.
4. Permission spellings conflict (`servers.provision` versus `server:…`); API backup/restore and MCP names also differ. Canonical future colon permissions and routes are listed in [management architecture](../architecture/minecraft-management.md). Existing routes/permissions stay compatible. These Minecraft APIs do not exist yet, so no compatibility alias is required. `/audit` stays canonical; no second audit store.
5. The input diagram puts bots and management on one node; [ADR 0016](../architecture/decisions/0016-node-provisioning-boundary.md) requires separate credentials/processes and no Docker/RCON in bot workers. Docker privilege is host compromise potential, including with a socket proxy.
6. Section 16 asks for privileged confirmation to disable allowlists; the family safety invariant is stricter. Family templates reject this, offline production authentication and public management ports. An unsafe-policy mode would require a new scope/ADR; no such implementation is planned.
7. Network examples differ on Bedrock TCP/UDP. Inspect pinned Geyser transport; expose only required game ports after approval, never infer TCP need. Expected Contabo paths/container/OS are hypotheses until approved inspection.
8. The unified text says family-ready after F2 but also requests stop/restart in its first deliverable. F2 is usable secure access/backup management; lifecycle controls are visibly unavailable until F3 broker qualification. Full initial feature set is F3, after F2.5. This explicit staging must appear in release/UI claims.
9. Automatic rollback must preserve worlds. Failed provisioning may remove only proven newly created runtime resources; retain all data-bearing volumes/backups and diagnostics even if created by the failed deployment. Reverting an image cannot undo a world migration.

## Earliest outcomes and authorization

**F1 observation preview**: an adult logs in, adopts the server in place, sees last observed state, connection guidance, players if supported, audit and unresolved security/backup gaps. No models, bots, write commands or Docker broker required. It is not family-ready.

**F2 family-ready management milestone**: the same dashboard securely approves/revokes verified Java/Bedrock identities, shows verified access state and backup health, creates backups, and has a successful isolated restore plus all applicable security/preservation gates. Actual production readiness additionally requires approved Contabo preflight/remediation and evidence. No readiness claim follows from documentation or fake tests.

First new management coding task ready for authorization: **CL-F0-01**, local fixture-driven, redacted read-only preflight. First coding task already authorized: **CL-03-07**, finish runtime qualification/review while preserving the dirty files. [Track](minecraft-track.md) defines the order and [handoff](handoffs/REC-01-unified-reconciliation.md) defines the exact stopping point.
