# Current delivery status

Last updated: 2026-10-31.

## Authorized scope

The user authorized Chapter 01 by requesting the next bit after the Chapter 00 review. Chapter 00 is accepted for advancement; this does not imply an independent security audit. Standing requirement: update plan, commit and push each build step to `origin main`, then verify synchronization. Chapter 02 is not yet authorized.

## Current checkpoint

- Chapter 00: implemented/verified; historical evidence in [review](../reviews/00-foundation.md).
- Chapter 01: CL-01-01 through CL-01-02 verified (2/7 tasks).
- Next: CL-01-03.
- Latest evidence: Implemented restricted-pool auth service, atomic one-time bootstrap, Argon2id password hashing, opaque hashed sessions, login rotation, idle/absolute expiry, logout/session revocation, persistent throttles, exact Origin checks and session-bound CSRF. Cookies are HttpOnly/SameSite=Strict and Secure on HTTPS; HTTP configuration is limited to loopback. `pnpm check` passed (13 unit tests); disposable database suite passed 16 integration tests, including bootstrap race, fixation/rotation, expiry, throttles, Origin/CSRF and HTTPS-cookie cases, plus migration rollback/tamper checks. Local synthetic Argon2id hash/verify each measured 9ms at 19MiB/t=2/p=1. Production Compose upgrade and all service health checks passed; setup remains unclaimed (no test owner created in the real local installation). Future authorization/invitation/recovery workflows are not yet implemented.
- Branch/remote: main → https://github.com/coldbathcode/craftlayer.git; each task is committed/pushed. See Git history and [build log](build-log.md) for exact checkpoints.
- Chapters 02–11 remain unimplemented; no paid inference, public app deployment or Cloud implementation.

## Continuity

Preserve the ignored `.env` and associated volumes; setup adds missing credentials without rotating existing ones. Never claim unrun checks passed. Read the chapter specification and current source before continuing. The original blueprint remains unchanged.
