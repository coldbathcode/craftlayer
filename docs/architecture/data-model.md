# Relational data model and tenant isolation

Status: logical design for the full product. Chapters 00–02 have authoritative SQL migrations for organizations/projects, identity/RBAC/recovery/audit and provider configuration/budget ledgers; later runtime entities remain planned. Use ordinary PostgreSQL; no Supabase-hosted dependency is introduced.

## Conventions

Use UUID identifiers, UTC `timestamptz`, explicit created/updated timestamps, optimistic `version` on mutable aggregates, bounded JSONB for adapter-specific validated settings, and relational columns for authorization and scheduling filters. IDs are not authorization. No unbounded transcripts in mission rows.

Tenant-owned rows carry non-null `organization_id`; project-specific rows also carry non-null `project_id` where the domain requires one. Global identities/installation settings are deliberately different and have tightly scoped repository methods. Never use nullable organization as an implicit global wildcard.

## Entities and constraints

| Area / table | Important fields and constraints |
| --- | --- |
| `users` | Global identity, normalized login/email if configured, password hash, disabled timestamp, auth version; minimal child profile, no required child email |
| `installation_settings` | Singleton instance ID, bootstrap completion, policy version, stop epoch; owner-only administrative path |
| `instance_owners` | User-to-instance privilege association; never inferred from org role |
| `organizations` | ID, name, status, policy version, stop epoch; scoped access to the root row itself |
| `memberships` | Organization, user, status; unique `(organization_id,user_id)` |
| `roles`, `permissions`, `role_permissions`, `membership_roles` | Global permission catalog; built-in role definitions seeded into each org; tenant-aware assignment references |
| `resource_grants` | Membership/role, resource type/ID, allowed actions and scope; no arbitrary free-text policy execution |
| `projects` | Organization, name, status; unique `(organization_id,id)` for composite FKs |
| `environments` | Org/project, type, connection reference, capability/policy version, stop epoch; never store plaintext connection secrets |
| `environment_grants` | Org, environment, membership, action restrictions; adult manages child assignments |
| `sessions` | User, hashed random token, expires/idle deadline, auth version, revocation; global identity queries via isolated auth repository |
| `cli_credentials` | Hashed token, principal, org/scopes, expiry/revocation; interactive one-time exchange, no provider key reuse |
| `invitations`, `password_reset_tokens` | Hashed single-use token, expiry, inviter/user scope, consumption; no recoverable raw token |
| `provider_connections` | Org, adapter type, allowlisted endpoint, enabled flag, credential reference, config version |
| `provider_credentials` | Org, ciphertext, nonce/tag, key version, redacted label; separate read permission and worker access path |
| `model_snapshots` | Org/provider, canonical model/version, capabilities, price dimensions/source, fetched/expiry times, content hash |
| `model_policies` | Org/project policy version, eligibility and fallback constraints, spending caps |
| `agent_templates` | Org/project, template version, environment type, bounded tool capabilities and prompt reference |
| `agents` | Org/project/environment/template, state, assignment, external session identity, heartbeat and version |
| `groups`, `group_agents` | Org/project/environment, role assignments; reject cross-environment group membership initially |
| `mission_templates`, `preset_approvals` | Immutable template versions, parameter schema, capabilities, approving adult, allowed scopes, expiry/revocation |
| `missions` | Org/project/environment/group, creator/execution grant, template snapshot/hash, lifecycle, reason, policy and stop epochs |
| `tasks` | Org/mission, kind, inputs/hash, state, priority, deadline, next attempt time, retry ceiling and current fence |
| `task_dependencies` | Org/mission, prerequisite/task IDs; both endpoints must belong to same mission, no self edges |
| `task_attempts` | Org/task, attempt sequence, worker/agent, fence, lease deadline, start/end, outcome and effect status |
| `action_receipts` | Org/task, stable action key, external effect reference, expected/observed state, outcome `confirmed/uncertain/rejected` |
| `worker_registrations` | Org-bound worker identity, capabilities, protocol version, credential fingerprint, revoked/expiry, last heartbeat |
| `approvals` | Org/mission/task, requester, action/patch/target hash, policy version, expiration, decision/approver; no self approval |
| `stop_latches` | Scope type/ID, org if applicable, generation, requested by, reason, active/cleared time; instance latch uses separate privileged path |
| `budgets`, `budget_windows` | Hierarchical scope, unit, cap, period, version, committed/reserved counters; integer micro-USD for money |
| `usage_reservations`, `usage_ledger` | Org/mission/task/request identity, estimated max/actual units, price snapshot, settlement state; unique idempotency keys |
| `events` | Org/project/mission, sequence cursor, typed payload version, visibility level, correlation/causation IDs |
| `audit_events` | Org or separately stored instance audit, actor, action, target, decision, redacted changes, request ID; insert-only app grants |
| `outbox` | Org, aggregate/version, event type/schema, payload references, created/published, retry count; unique event ID |
| `idempotency_keys` | Org/principal/route/key, request digest, response reference, expiry; same key with different input conflicts |
| `blackboard_entries`, `resource_reservations` | Org/mission, typed claim, source/version, TTL, size bound; resource reservation unique by environment/resource range |
| `artifacts`, `research_sources`, `research_claims` | Org/project/mission, safe storage path/hash, content type/size, retention; citations reference exact source snapshots |

Do not implement every table in Chapter 00. Start with migration infrastructure, organization/project foundations and policy context; introduce each domain table with its owning chapter.

## Tenant-aware relational integrity

Every tenant-scoped parent exposes a unique `(organization_id,id)`. Child FKs include organization and parent ID; project/world relationships use equivalent composite constraints. A task dependency also ties both task IDs to the same mission. Application checks alone cannot prevent a forged cross-org foreign key.

Examples of required uniqueness: one membership per org/user, one committed result per task generation, one ledger settlement per provider request, one action receipt per stable action key, one active agent assignment per agent, and one active lease per task. Use partial unique indexes for active-only invariants where appropriate.

## Row-level security

Application repositories require an authenticated organization context; RLS provides an additional boundary. Runtime DB roles are non-owner and have neither superuser nor BYPASSRLS privileges. Enable and force RLS on tenant tables, with both read/write policies, and isolate migration privileges. Table-owner and superuser exceptions require explicit tests. [PostgreSQL row security documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

Set organization/user context with transaction-local settings after validating the session or worker principal. Missing context denies access. Never use connection-global tenant settings in a pool. Test sequential organization A/B requests on the same physical connection, including rollback and timeout. The trusted service can set context, so RLS does not replace parameterized SQL, application authorization or isolation from compromised services.

Authentication must resolve identities before an organization is selected. Keep login/session lookup functions narrow, separate from tenant-data repositories, with no general-purpose bypass connection available to routes. Instance-wide maintenance uses an explicitly privileged service path with separate audit; normal org admins never gain it.

## Query and index plan

| Query | Planned index / constraint |
| --- | --- |
| Mission list for org/project/state | `(organization_id,project_id,state,created_at DESC,id)` |
| Ready task candidates | Partial `(organization_id,next_attempt_at,priority,created_at)` for ready/retryable states |
| Lease recovery | Partial `(lease_expires_at)` on active attempts; recover through validated per-org maintenance context |
| Mission dependency checks | `(organization_id,mission_id,task_id)` and prerequisite side index |
| Authorized event replay | `(organization_id,sequence)` plus scoped mission/time indexes |
| Audit lookup | `(organization_id,created_at DESC,id)` and target lookup |
| Outbox relay | Partial `(created_at,id)` where unpublished, scoped relay lease |
| Provider catalog eligibility | Unique `(organization_id,provider_connection_id,canonical_model_id,snapshot_version)` |
| Usage reconciliation | Unique request/settlement keys and `(organization_id,budget_window_id,state)` |

Index foreign-key lookup columns and common tenant filters; use `EXPLAIN (ANALYZE, BUFFERS)` on generated non-sensitive datasets before declaring an index useful. Avoid blanket indexes on JSONB or every column. Define retention and batch pruning before event volume grows. Partitioning is deferred until measured retention/volume justifies it.

## Transactions and concurrency

- Mission creation commits template snapshot, tasks/dependencies, grants, audit and outbox atomically.
- Scheduler claims eligible rows under row locks/conditional updates and increments fences. Do not hold a DB transaction open across a provider or Minecraft call.
- Budget reservation locks applicable counters in stable scope order; all applicable limits accept or the transaction rolls back.
- Task completion compares current attempt/fence and mission generation; late workers cannot overwrite current results.
- Membership disable/revocation increments authorization version and invalidates future execution checks, including existing sessions and queued grants.
- Keep pool size bounded per process and document the total connection budget. Transactions must roll back on timeout; no automatic retries for unknown external effect outcomes.

## Retention and deletion

Initial configurable defaults: runtime event payloads 7 days, redacted audit 90 days, coding/research artifacts 30 days; all are engineering defaults to validate, not legal retention advice. Mission summaries and ledger records use separate retention. Purge expired secrets/tokens promptly. Restrict deletion while executions or backups depend on objects; stop/revoke first, then garbage collect. Record what backups retain and when it expires. Never cascade-delete audit history during a normal mission delete.

## Migration proof

Every schema chapter tests empty database, upgrade from previous fixture, rollback-on-failure, tenant FKs/RLS, least-privileged runtime permissions and retention behavior. Seed built-in roles idempotently. Test that restore includes encrypted secrets plus the required separately protected key material, without storing keys in the dump.

## Implemented identity boundary

Migrations `0002_identity.sql` through `0004_recovery_outbox.sql` define restricted global identity tables, forced-RLS tenant tables and encrypted mail delivery intent. `craftlayer_identity` is a non-owner without DDL/BYPASSRLS, provided only to the API auth service and local recovery CLI. Runtime cannot read users/sessions/reset data; worker and browser receive no identity credential. Scoped SQL uses transaction-local context; the narrow identity-only membership-discovery policy is keyed by authenticated user ID. See [ADR 0012](decisions/0012-identity-boundary.md).

## Implemented provider boundary

Migrations `0005_provider_connections.sql` through `0007_provider_budget_ledger.sql` introduce encrypted connections, catalog snapshots, policy/stop/cooldown state, hierarchical budget windows, request replay identities, reservations/links and an append-only usage ledger. SQL migrations are authoritative for forced RLS, checks, roles and grants; Drizzle metadata describes the same relationships. Global instance counters require the internal transaction flag and are not exposed in tenant reports. Numeric counters are integer decimal strings at the API. Mission/task labels do not yet reference canonical runtime entities; Chapter 03 must establish that boundary. See ADR 0013 for conservative settlement and the operator runbook for recovery.
