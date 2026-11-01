# Current delivery status

Last updated: 2026-11-01.

## Authorized scope

The user's next-steps request after Chapter 02 authorizes Chapter 03. Chapters 00–02 are accepted for advancement, not independent security certification. Chapter 04 requires authorization. Every coherent build step updates plans, commits/pushes origin main and verifies clean synchronization.

## Current checkpoint

- Chapters 00–02 implemented/verified; [provider review](../reviews/02-provider-gateway.md), hosted final CI 41292488668 passed at base `9c9981b`.
- Chapter 03: CL-03-01 through CL-03-04 verified (4/7).
- Latest evidence: Completed registered workers with bounded strict model proposals (two repairs), persisted request IDs/cache and provider-ledger dispatch fencing; exact-action independent adult approvals bind generation/policy and current initiating/approving sessions. pnpm check passed 196 unit tests; final pnpm typecheck and lint passed; pnpm test:db passed 76 database/API cases plus migration rollback/tamper proofs. Evidence includes 100 claim races, duplicate model decisions, invalid tools/fields, pre-dispatch creator/worker revocation, dispatched unknown inference holds, self/child/viewer approval denial, changed-policy invalidation, approver revocation and session-expiry deadline clamping. All provider calls used local fakes. Worker-process hosted CI 41315179729 passed. Next: CL-03-05 persistent pause/cancel/emergency stop.
- Next: CL-03-05.
- Read [Chapter 03](../chapters/03-fleet-engine.md), [ADR 0014](../architecture/decisions/0014-runtime-authority-and-recovery.md) and its runtime/data/security references before continuing.
- Main UI: http://127.0.0.1:3000/account. Preserve ignored credentials/volumes; preserve existing account state. Tests use disposable installations only.
- Branch/remote: main → https://github.com/coldbathcode/craftlayer.git. See [build log](build-log.md) for exact task evidence.
- Chapters 04–11 unimplemented; no live/paid inference, public deployment, real mail or Cloud implementation authorized.
