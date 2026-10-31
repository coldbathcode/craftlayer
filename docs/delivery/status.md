# Current delivery status

Last updated: 2026-10-31.

## Authorized scope

The user authorized Chapter 01 by requesting the next bit after the Chapter 00 review. Chapter 00 is accepted for advancement; this does not imply an independent security audit. Standing requirement: update plan, commit and push each build step to `origin main`, then verify synchronization. Chapter 02 is not yet authorized.

## Current checkpoint

- Chapter 00: implemented/verified; historical evidence in [review](../reviews/00-foundation.md).
- Chapter 01: CL-01-01 through CL-01-03 verified (3/7 tasks).
- Next: CL-01-04.
- Latest evidence: Added table-driven permission/account/scope policy, canonical project/world lookup, membership-derived authority, transactional guards, filtered lists and owner-only organization creation. Child ceilings apply even with an extra admin role and reject coding/research worlds; Builder execution needs explicit scoped delegation. Added signed, expiring execution grants bound to user/membership versions, exact resource and originating session; grants are internal primitives, not a running worker engine. `pnpm check` passed (156 unit/policy tests); disposable DB suite passed 21 integration tests including cross-org IDs, filtered reads, admin vs instance owner, tamper/logout grant denial and HTTP permission/body-scope negatives. All queries remain parameterized and tenant-context checked.
- Branch/remote: main → https://github.com/coldbathcode/craftlayer.git; each task is committed/pushed. See Git history and [build log](build-log.md) for exact checkpoints.
- Chapters 02–11 remain unimplemented; no paid inference, public app deployment or Cloud implementation.

## Continuity

Preserve the ignored `.env` and associated volumes; setup adds missing credentials without rotating existing ones. Never claim unrun checks passed. Read the chapter specification and current source before continuing. The original blueprint remains unchanged.
