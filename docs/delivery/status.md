# Current delivery status

Last updated: 2026-10-31.

## Authorized scope

The user authorized Chapter 01 by requesting the next bit after the Chapter 00 review. Chapter 00 is accepted for advancement; this does not imply an independent security audit. Standing requirement: update plan, commit and push each build step to `origin main`, then verify synchronization. Chapter 02 is not yet authorized.

## Current checkpoint

- Chapter 00: implemented/verified; historical evidence in [review](../reviews/00-foundation.md).
- Chapter 01: CL-01-01 through CL-01-04 verified (4/7 tasks).
- Next: CL-01-05.
- Latest evidence: Implemented single-use, expiring/revocable invitations (including existing adult account joins), current-inviter permission checks, scoped member/role administration, bounded custom-role delegation, membership suspension, resource-grant removal and instance-owner-only global disable/restore. Role/scope changes bump membership authority versions; global disable revokes sessions. Last active instance owner and last adult org admin are protected. Added append-only, bounded audit detail columns without changing applied migrations. `pnpm check` passed (156 unit/policy tests); disposable DB suite passed 27 integration tests plus migration rollback/tamper checks, covering invite replay/races/expiry, role escalation, membership-vs-user disable, grant revocation, multi-org joins and last-owner/admin protections.
- Branch/remote: main → https://github.com/coldbathcode/craftlayer.git; each task is committed/pushed. See Git history and [build log](build-log.md) for exact checkpoints.
- Chapters 02–11 remain unimplemented; no paid inference, public app deployment or Cloud implementation.

## Continuity

Preserve the ignored `.env` and associated volumes; setup adds missing credentials without rotating existing ones. Never claim unrun checks passed. Read the chapter specification and current source before continuing. The original blueprint remains unchanged.
