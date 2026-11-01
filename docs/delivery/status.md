# Current delivery status

Last updated: 2026-11-01.

## Authorized scope

The user requested “keep going next steps” after Chapter 01 review, authorizing Chapter 02. Chapters 00–01 are accepted for advancement, not independently security certified. Chapter 03 requires authorization. Standing requirement: update plans, commit/push each coherent build step to origin main and verify clean synchronization.

## Current checkpoint

- Chapters 00–01: implemented/verified; [identity review](../reviews/01-identity-and-rbac.md), hosted CI 41254297886 passed.
- Chapter 02: CL-02-01 through CL-02-05 verified (5/7).
- Next: CL-02-06.
- Latest evidence: Added policy intersection, per-scope model/capability/price/input ceilings, deterministic eligible fallback, bounded cooldown/backoff and a dispatch barrier after metadata/DNS validation. Zero instance/scope spend cannot be bypassed by relaxing an organization free-only flag. Added persisted org/user/project policy versions, redacted catalog refresh/list routes, refresh throttling, cooldown storage and a durable separately cleared provider stop latch. pnpm check passed 188 tests; fake routing proves reservation-before-dispatch, independent fallback reservations, synthetic 429 to eligible local only, zero paid/ineligible calls, input/authority-field rejection and policy/stop tightening before dispatch. pnpm test:db passed 45 integration cases plus migration negatives, including fake-only catalog operations, disabled snapshot invalidation, optimistic policy changes, wrong scopes and stop persistence across service restart/policy edits. No production generation endpoint/composition is wired; the router currently requires an injected reservation port, with real accounting next in CL-02-06. No paid/live inference or catalog calls were sent.
- UI: http://127.0.0.1:3000/account. Preserve the real installation and its ignored local credentials/volumes. Tests use disposable fixtures, never claim the user's owner account.
- Branch/remote: main → https://github.com/coldbathcode/craftlayer.git; see [build log](build-log.md) and Git for each task publication.
- Chapters 03–11 remain unimplemented; no paid inference, live provider calls, public deployment or Cloud implementation.

## Continuity

Read [Chapter 02](../chapters/02-provider-gateway.md), [ADR 0013](../architecture/decisions/0013-provider-gateway-boundary.md), current source and the exact next task before continuing. Preserve the unchanged source blueprint. Never claim unexecuted checks passed.
