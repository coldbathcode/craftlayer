# Current delivery status

Last updated: 2026-11-01.

## Authorized scope

The user's next-steps request after Chapter 02 authorizes Chapter 03. Chapters 00–02 are accepted for advancement, not independent security certification. Chapter 04 requires authorization. Every coherent build step updates plans, commits/pushes origin main and verifies clean synchronization.

## Current checkpoint

- Chapters 00–02 implemented/verified; [provider review](../reviews/02-provider-gateway.md), hosted final CI 41292488668 passed at base `9c9981b`.
- Chapter 03: CL-03-01 through CL-03-01 verified (1/7).
- Latest evidence: Implemented strict bounded simulation task/graph contracts and pure dependency/outcome/state rules, plus tenant-aware fleet/group/template/mission/task/attempt/event/receipt/approval schema and immutable snapshot/state triggers. Explicit simulation environments preserve the Minecraft-only child ceiling. pnpm check passed 191 tests; pnpm test:db passed 59 database/API cases plus fresh/repeat/rollback/checksum proofs. New PostgreSQL evidence rejects cross-mission edges, unverified/invalid transitions, snapshot mutation and foreign/missing org context; a verified deterministic task and mission reach success. ADR 0014 records the API/worker boundary and truthful cancelling state. No queue, public mission API or external effects are wired yet. Next: CL-03-02 scoped mission API, grants and CLI.
- Next: CL-03-02.
- Read [Chapter 03](../chapters/03-fleet-engine.md), [ADR 0014](../architecture/decisions/0014-runtime-authority-and-recovery.md) and its runtime/data/security references before continuing.
- Main UI: http://127.0.0.1:3000/account. Preserve ignored credentials/volumes; real owner remains unclaimed. Tests use disposable installations only.
- Branch/remote: main → https://github.com/coldbathcode/craftlayer.git. See [build log](build-log.md) for exact task evidence.
- Chapters 04–11 unimplemented; no live/paid inference, public deployment, real mail or Cloud implementation authorized.
