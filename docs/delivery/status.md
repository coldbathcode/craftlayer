# Current delivery status

Last updated: 2026-11-01.

## Authorized scope

The user's next-steps request after Chapter 02 authorizes Chapter 03. Chapters 00–02 are accepted for advancement, not independent security certification. Chapter 04 requires authorization. Every coherent build step updates plans, commits/pushes origin main and verifies clean synchronization.

## Current checkpoint

- Chapters 00–02 implemented/verified; [provider review](../reviews/02-provider-gateway.md), hosted final CI 41292488668 passed at base `9c9981b`.
- Chapter 03: CL-03-01 through CL-03-02 verified (2/7).
- Latest evidence: Added a private runtime coordinator package and scoped REST/SDK/CLI fleet/template/mission commands with canonical environment lookup, immutable snapshots, expected versions, current execution grants and actor/route/body-bound UUID idempotency. Added protected CLI sessions with hidden/stdin login and explicit scoped commands. pnpm check passed 191 tests; pnpm test:db passed 62 database/API tests plus migration negatives. Eight concurrent create/execute HTTP replays yield one logical execution and audit; snapshot revisions, foreign/wrong worlds, cycles, ungranted viewer/child access, actual CLI login/get/execute/logout, grant revocation and CLI viewer denial are covered. An initial audit assertion omitted RLS context and was corrected to query under the tenant transaction; no bypass was added. No scheduler or worker effects are wired; queued is truthful. Next: CL-03-03 outbox, fairness, quotas and reconciliation.
- Next: CL-03-03.
- Read [Chapter 03](../chapters/03-fleet-engine.md), [ADR 0014](../architecture/decisions/0014-runtime-authority-and-recovery.md) and its runtime/data/security references before continuing.
- Main UI: http://127.0.0.1:3000/account. Preserve ignored credentials/volumes; real owner remains unclaimed. Tests use disposable installations only.
- Branch/remote: main → https://github.com/coldbathcode/craftlayer.git. See [build log](build-log.md) for exact task evidence.
- Chapters 04–11 unimplemented; no live/paid inference, public deployment, real mail or Cloud implementation authorized.
