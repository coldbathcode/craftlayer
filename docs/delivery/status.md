# Current delivery status

Last updated: 2026-11-01.

## Authorized scope

The user requested “keep going next steps” after Chapter 01 review, authorizing Chapter 02. Chapters 00–01 are accepted for advancement, not independently security certified. Chapter 03 requires authorization. Standing requirement: update plans, commit/push each coherent build step to origin main and verify clean synchronization.

## Current checkpoint

- Chapters 00–01: implemented/verified; [identity review](../reviews/01-identity-and-rbac.md), hosted CI 41254297886 passed.
- Chapter 02: CL-02-01 through CL-02-04 verified (4/7).
- Next: CL-02-05.
- Latest evidence: Implemented bounded OpenRouter catalog normalization and one-model chat transport against official API contracts. Canonical model IDs are allowlisted; auto routers and paid plugin/routing suffixes are rejected. Documented price dimensions normalize with exact decimal units; omitted and unrecognized charges remain unknown, and strict zero-cost enforcement is never inferred from a free suffix. Generation refreshes pricing before dispatch, disables fallback/plugin/transform arrays, sets documented maximum price and output controls, suppresses key echoes and performs no hidden retry. pnpm check passed 183 tests including synthetic paid price changes, unknown charges, one-model/no-fallback request shape and 429/auth/timeout/unavailable behavior with one dispatch each. No real OpenRouter catalog/key or inference endpoint was contacted; complete hosted free-only support remains explicitly unproved/ineligible per ADR 0013. Next: CL-02-05 policy intersection, deterministic eligible fallback, persisted cooldown/stop and reservation-interface wiring; production generation remains disconnected until the durable ledger task.
- UI: http://127.0.0.1:3000/account. Preserve the real installation and its ignored local credentials/volumes. Tests use disposable fixtures, never claim the user's owner account.
- Branch/remote: main → https://github.com/coldbathcode/craftlayer.git; see [build log](build-log.md) and Git for each task publication.
- Chapters 03–11 remain unimplemented; no paid inference, live provider calls, public deployment or Cloud implementation.

## Continuity

Read [Chapter 02](../chapters/02-provider-gateway.md), [ADR 0013](../architecture/decisions/0013-provider-gateway-boundary.md), current source and the exact next task before continuing. Preserve the unchanged source blueprint. Never claim unexecuted checks passed.
