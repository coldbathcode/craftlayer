# Current delivery status

Last updated: 2026-11-01.

## Authorized scope

The user's next-steps request after Chapter 02 authorizes Chapter 03. Chapters 00–02 are accepted for advancement, not independent security certification. Chapter 04 requires authorization. Every coherent build step updates plans, commits/pushes origin main and verifies clean synchronization.

## Current checkpoint

- Chapters 00–02 implemented/verified; [provider review](../reviews/02-provider-gateway.md), hosted final CI 41292488668 passed at base `9c9981b`.
- Chapter 03: CL-03-01 through CL-03-06 verified (6/7).
- Latest evidence: Completed scoped REST replay/SSE, encrypted user/session/org/environment/mission cursors, bounded snapshots/resync, strict event projections, browser-safe parser and reconnecting CLI watch. Current authority is rechecked before bounded enqueue; limits and backpressure bound connections/buffering. pnpm check passed 198 unit tests; final typecheck/lint/docs passed; pnpm test:db passed 85 database/API cases plus migration proofs. Actual HTTP and CLI watch prove replay/dedup, expired-cursor snapshot, foreign/tampered cursor denial, connection/origin caps, prompt session-revocation close and controlled socket-backpressure cleanup. Recovery checkpoint also proves old-fence rejection, no blind prepared-effect retry and exact-evidence conservative adult reconciliation. Recovery hosted CI 41319243310 passed. Actual Redis/container restart drill and final review remain CL-03-07.
- Next: CL-03-07.
- Read [Chapter 03](../chapters/03-fleet-engine.md), [ADR 0014](../architecture/decisions/0014-runtime-authority-and-recovery.md) and its runtime/data/security references before continuing.
- Main UI: http://127.0.0.1:3000/account. Preserve ignored credentials/volumes; preserve existing account state. Tests use disposable installations only.
- Branch/remote: main → https://github.com/coldbathcode/craftlayer.git. See [build log](build-log.md) for exact task evidence.
- Chapters 04–11 unimplemented; no live/paid inference, public deployment, real mail or Cloud implementation authorized.
