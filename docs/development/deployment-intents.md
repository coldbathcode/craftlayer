# Durable deployment intake

Status: CL-F25-03 checkpoint A, private metadata service only. `ReservationLedger.queueDeployment` and `deploymentIntent` have no REST, SDK, MCP, queue publisher, worker claim, signer, lease or native effect route. [Reservation ledger](node-reservations.md), [broker](node-broker.md) and [ADR 0021](../architecture/decisions/0021-node-reservation-ledger.md) define the surrounding gates.

The request contains only reservation ID, expected reservation version and the exact earlier metadata dispatch-operation ID. It cannot assert qualification, approval, image, command, organization or execution flags. Current authenticated adult membership must have project `node:deploy` and canonical same-project Minecraft `server:provision`. The initiating actor/session must match the reservation and dispatch record. Intake requires allocated state/current version, unchanged active node/key and unexpired credential, plus no shared instance/org/environment stop. Replay revalidates these conditions and current permissions/session; a body change conflicts. A different session cannot resume or launder a revoked initiating request.

SQL 0021 keeps an immutable `pending_qualification`, execution-disabled intent and one reference-only outbox record. One reservation has at most one intent; concurrent identical idempotency keys return the same operation ID. Composite tenant FKs and a locked parent/dispatch-kind/actor/session insert guard bind the exact allocation. Forced RLS and SELECT/INSERT-only runtime grants protect records/history. Rolling 12/actor/minute and 10,000/project/day intake limits avoid lifetime-history lockout. Request, audit and outbox commit atomically under the existing organization/node barrier. No external admission I/O occurs inside this transaction.

The durable operation ID is the intake ID; it is not an issued node command or proof of Minecraft readiness. Reading uses current scoped adult authority. Existing generic operation REST does not expose this private resource yet. Reservations and ports stay allocated and cannot ordinary-release when an intent is abandoned. There is no force-clear/cancel/archival shortcut. Actor/session IDs are references for later current revalidation, never sufficient worker authority on their own.

## Checks

```bash
pnpm check
pnpm test:db
```

Nine new real PostgreSQL cases cover concurrent replay/atomic records/reopen, child/viewer/anonymous/foreign denial, held/uncertain/wrong-version/wrong-dispatch refusal, current session/role removal, rotation/revocation, another-session refusal, shared stops, forced RLS, immutable disabled state and same-reservation SQL references. Two contract cases reject caller qualification/commands and enabled/ready outcomes. Reservation admission/approval used to obtain test allocations is explicitly fake. These are not real host qualification or physical dispatch tests.

## Next composition and recovery

Next implement a separate durable controller job/attempt/lease/fence and immutable signed command/receipt record, then an authenticated outbound node command/permit path. Before issuing each fresh nonce-bound permit, revalidate the initiating current actor/session/membership/dual scope, independent adult approval, node/key/policy, exact reservation/manifest, stop generation and real qualification outside SQL followed by a short current recheck. Expiry/partition or unknown acknowledgement must retain uncertainty; never blindly reissue a physical command. Publish only references, not credentials, manifests, grants or secret-bearing data, through queues/outbox projections.

Existing inventory transport remains unchanged and cannot execute the intent. Default production admission/approval/persistent-world quota adapters remain unavailable. Do not promote an intake or a test fake to an executable job to bypass F2 access/identity/backup/restore or F2.5 host gates.

For this additive metadata migration, rollback means running the preceding application while retaining schema/intents/audit/outbox and allocations; older code ignores them. Prefer a forward correction over dropping history or freeing unknown allocations. No world or Docker rollback is involved. Before any future production migration/deployment, obtain the separate approval and verified database/world recovery required by repository instructions; no such deployment is authorized by this checkpoint.
