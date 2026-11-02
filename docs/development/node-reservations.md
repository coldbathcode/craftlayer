# Node resource reservation ledger

Status: CL-F25-02 checkpoint B, private domain/storage primitives. SQL 0020/Drizzle/contracts and real disposable PostgreSQL tests exist. No API/SDK/MCP route, production qualified-admission adapter or Docker dispatch is wired. [ADR 0021](../architecture/decisions/0021-node-reservation-ledger.md) describes the trust boundary.

`ReservationLedger` requires current adult placement/provision permission and canonical node/environment membership before reading/holding capacity. It obtains complete qualified admission outside SQL and revalidates current authority afterward. Without its private admission adapter it returns unavailable; a browser cannot supply `qualified`, image/path/resources or approval fields. The current inventory-only agent cannot assert the missing host/template/recovery qualifications. The existing Family Survival artifacts remain unqualified.

Holds reserve **metadata only**: two CPU cores, 6144 MiB container RAM, 20480 MiB world storage, chosen Java TCP/Bedrock UDP ports and newly generated deployment/server/world identities. A 60s lease covers undispatched preparation. Node row/advisory locks plus a unique protocol/port claim prevent competing controller allocations from overbooking. Current Docker reports and complete admission conflicts both participate; native host services must be included by the future qualified adapter. All four tenant tables force RLS/composite FKs and restricted grants; immutable bindings/resources/operation/outbox history cannot be rewritten by the service.

The current states are `held → allocated → uncertain`, or `held → released`. Release is allowed only before dispatch, with current permission/version/idempotency. Expired held rows are released on a subsequent successful admission/dispatch transaction and retain history/audit. Allocated or uncertain capacity/ports never expire or ordinary-release, even after credential rotation or a deadline. They are not evidence that a game is ready. No physical rollback, data deletion or volume release occurs.

Dispatch intent requires a fresh private qualification, a non-null independently verified approval reference, matching policy/template, unexpired hold/node credentials/version, aggregate capacity, current ports and no shared stop. The injected port must verify actual independent human authority/EULA/qualification; the fake in tests is not a production approval implementation. Control-plane durable job/approval/current-authority integration remains next work, so no dispatch endpoint is available.

## Verification

```bash
pnpm check
pnpm test:db
```

The DB harness creates a fourth isolated reservation database with fresh/repeated migrations and a separate identity fixture. Eleven cases cover concurrent replay/atomic audit/outbox, one same-port race winner, separate CPU/RAM/disk exhaustion, held expiry/history, fresh dispatch approval, SQL retained-port protection, uncertainty after expiry, new host conflicts/budget/policy changes, anonymous/child/viewer/foreign/current-revoked authority, unavailable admission, instance-stop RLS visibility, immutable bindings/history, tenant FKs and expected-version/idempotent release. Resource/approval qualification is deliberately fake; no real Docker quota, game/client/backup/restore or production proof is claimed.

## Recovery

Do not force-release allocated/uncertain records, delete their ports or edit migration checksums to make capacity appear free. Preserve exact operation/node/deployment/world/fence evidence and node journals. A future reconciliation must prove which runtime resources exist and retain/account for world/backup storage before any release. Current schema blocks such release rather than offering an unsafe bypass. Application rollback can leave additive tables unused; do not drop historical state or shared data. Follow the [world preservation procedure](../operations/minecraft-preservation.md) before any future live effect.
