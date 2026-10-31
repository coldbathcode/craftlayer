# Current delivery status

Last updated: 2026-10-31.

## Authorized scope

The user authorized Chapter 01 by requesting the next bit after the Chapter 00 review. Chapter 00 is accepted for advancement; this does not imply an independent security audit. Standing requirement: update plan, commit and push each build step to `origin main`, then verify synchronization. Chapter 02 is not yet authorized.

## Current checkpoint

- Chapter 00: implemented/verified; historical evidence in [review](../reviews/00-foundation.md).
- Chapter 01: CL-01-01 through CL-01-01 verified (1/7 tasks).
- Next: CL-01-02.
- Latest evidence: Implemented identity/session/membership/role/grant/invitation/reset/audit schema, immutable permission templates, forced tenant RLS and composite role/world FKs. Added a dedicated non-owner identity role, column-restricted identity updates and owner/child safety triggers; runtime cannot read global identities. Added a one-shot owner provisioner and additive local secret setup for existing installations. `pnpm check` passed (12 unit tests); `pnpm test:db` passed 10 DB tests plus migration rollback/checksum checks. Fresh and repeat migrations passed. Existing local Compose upgrade, role provisioning and all five service health checks passed without replacing existing passwords. Login/session/API behavior is not yet implemented.
- Branch/remote: main → https://github.com/coldbathcode/craftlayer.git; each task is committed/pushed. See Git history and [build log](build-log.md) for exact checkpoints.
- Chapters 02–11 remain unimplemented; no paid inference, public app deployment or Cloud implementation.

## Continuity

Preserve the ignored `.env` and associated volumes; setup adds missing credentials without rotating existing ones. Never claim unrun checks passed. Read the chapter specification and current source before continuing. The original blueprint remains unchanged.
