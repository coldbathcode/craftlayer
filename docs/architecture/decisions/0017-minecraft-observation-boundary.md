# ADR 0017 — F1 registry, observation authority and session locking

Status: adopted for authorized F1 local implementation, 2026-11-02. F2 and production actions remain separately gated.

## Decision

Use `packages/minecraft-control` for server/operation services, current `packages/auth` resource guards, strict JSON-safe contracts and additive SQL migration 0016/Drizzle metadata. F1 operations register/unregister metadata or observe; they never mutate a game container/world. Canonical tenant/project/Minecraft-environment scope is reloaded. Child ceilings deny all management permissions in this adult preview, including if a child has an extra admin role. Viewer/Operator reads require explicit new scoped grants; existing unrelated environment grants do not silently become server-management authority.

Adoption binds an operator-approved opaque target and immutable world/container fingerprint. Requesters cannot supply host paths, Docker options, images, arbitrary commands or credentials. Registration commits durable operation/audit/reference-only outbox atomically. Same actor/kind/key/body replays one reference, changed body conflicts, current authorization still required. F1 outbox is durable change intent; no queue consumer or physical exactly-once claim is implied. Captured observations are timestamped, stale after 60 seconds, never family-ready; missing/unsupported data is explicit.

`guardResource` additionally exposes the already-validated pure authority view, never its identity pool. All SQL callbacks remain bounded with no adapter/network I/O. Adapter reads occur outside guards followed by revalidation. Immutable session UUID is recorded without a foreign key to global `sessions`: the identity guard holds an update lock on that session while the separate runtime-role transaction commits, and a referencing FK would wait for the transaction waiting on that commit. Canonical live session authority comes from the guard, not existence of an FK. Tenant membership/project/environment FKs remain enforced.

Migration 0016 seeds new permissions for future roles and existing built-in adult roles. A migration-role-only temporary organization discovery policy is created/dropped within the migration transaction, with per-tenant context for role updates; it is absent after commit. No applied migration is rewritten and no identity credential is granted to the management service.

## Evidence and next checkpoint

CL-F1-01: current unit/type checks and disposable database upgrade, concurrent replay, RLS/FK, child/viewer/foreign scope and revocation proofs are recorded in the build log. The first fixture used the wrong session token encoding; after correction the database suite exposed the cross-pool FK lock, which was removed rather than weakening auth locks. A dedicated management test database prevents fixture bootstrap/recovery secrets from affecting the prior identity suite.

CL-F1-02 adds protected inventory and read-only observation adapters, API/SDK and fencing/recovery of observation operations. CL-F1-03 adds parent UI/local qualification. No live Contabo, remote MFA/private-entry, real identity or backup/restoration claim follows from local tests.
