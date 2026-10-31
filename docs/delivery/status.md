# Current delivery status

Last updated: 2026-10-31.

## Authorized scope

The user authorized Chapter 01 by requesting the next bit after the Chapter 00 review. Chapter 00 is accepted for advancement; this does not imply an independent security audit. Standing requirement: update plan, commit and push each build step to `origin main`, then verify synchronization. Chapter 02 is not yet authorized.

## Current checkpoint

- Chapter 00: implemented/verified; historical evidence in [review](../reviews/00-foundation.md).
- Chapter 01: CL-01-01 through CL-01-05 verified (5/7 tasks).
- Next: CL-01-06.
- Latest evidence: Added optional TLS SMTP recovery with generic responses, hashed single-use 30-minute reset tokens and an encrypted/fenced/bounded mail outbox (disabled by default). Added local owner credential recovery via hidden/stdin CLI input, session/version invalidation, adult-created child accounts without email, assigned Minecraft-only access and adult-managed child password reset. `pnpm check` passed (157 unit/policy/config tests); disposable DB suite passed 32 integration tests plus migration rollback/tamper checks, including encrypted-token storage, reset races/replay/expiry, delivery retry limits, CLI stdin recovery, disabled-account preservation, child role/world restrictions and session revocation after password change. No real email was sent; tests use local delivery fakes. Outbox/session secrets remain outside browser, logs and Git.
- Branch/remote: main → https://github.com/coldbathcode/craftlayer.git; each task is committed/pushed. See Git history and [build log](build-log.md) for exact checkpoints.
- Chapters 02–11 remain unimplemented; no paid inference, public app deployment or Cloud implementation.

## Continuity

Preserve the ignored `.env` and associated volumes; setup adds missing credentials without rotating existing ones. Never claim unrun checks passed. Read the chapter specification and current source before continuing. The original blueprint remains unchanged.
