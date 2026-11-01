# Current delivery status

Last updated: 2026-11-01.

## Authorized scope

The user's next-steps request after Chapter 02 authorizes Chapter 03. Chapters 00–02 are accepted for advancement, not independent security certification. Chapter 04 requires authorization. Every coherent build step updates plans, commits/pushes origin main and verifies clean synchronization.

## Current checkpoint

- Chapters 00–02 implemented/verified; [provider review](../reviews/02-provider-gateway.md), hosted final CI 41292488668 passed at base `9c9981b`.
- Chapter 03: CL-03-01 through CL-03-05 verified (5/7).
- Latest evidence: Implemented persistent instance/org/environment/mission stop latches and epochs, fenced pause/cancel/resume, exact operation clear and acknowledgement/quiescence/unreachable projections. Added owner-only protected local CLI stop requiring PostgreSQL but no API/UI/Redis; no recovery HTTP route. pnpm check passed 196 unit tests; final typecheck/lint/docs passed; pnpm test:db passed 80 database/API tests plus migration negative proofs. Tests cover coordinator restart, late result denial, explicit clear without resume, pending cancellation vs prepared-effect uncertainty, role/scope denial, actual local CLI with unreachable Redis and stop winning provider dispatch. Existing fake-clock watchdog proofs bound connected denial to one second and hung-heartbeat effects before a six-second action deadline; physical adapters remain unqualified. Fixed resume session-lock ordering exposed by the suite. Next: CL-03-06 authorized streams and expired-attempt recovery.
- Next: CL-03-06.
- Read [Chapter 03](../chapters/03-fleet-engine.md), [ADR 0014](../architecture/decisions/0014-runtime-authority-and-recovery.md) and its runtime/data/security references before continuing.
- Main UI: http://127.0.0.1:3000/account. Preserve ignored credentials/volumes; preserve existing account state. Tests use disposable installations only.
- Branch/remote: main → https://github.com/coldbathcode/craftlayer.git. See [build log](build-log.md) for exact task evidence.
- Chapters 04–11 unimplemented; no live/paid inference, public deployment, real mail or Cloud implementation authorized.
