# Current delivery status

Last updated: 2026-11-01.

## Authorized scope

The user requested “keep going next steps” after Chapter 01 review, authorizing Chapter 02. Chapters 00–01 are accepted for advancement, not independently security certified. Chapter 03 requires authorization. Standing requirement: update plans, commit/push each coherent build step to origin main and verify clean synchronization.

## Current checkpoint

- Chapters 00–01: implemented/verified; [identity review](../reviews/01-identity-and-rbac.md), hosted CI 41254297886 passed.
- Chapter 02: CL-02-01 through CL-02-02 verified (2/7).
- Next: CL-02-03.
- Latest evidence: Implemented org/connection/key-version-bound AES-256-GCM credential storage, protected key-ring and operator endpoint files, rotation/rewrap/revocation, optimistic connection versions, forced RLS/composite references and strict redacted administration routes. Added a narrow auth guard holding current authority across bounded provider SQL without exposing the identity pool. Default Core has no provider files, provider key requirement or egress; optional provider Compose uses protected read-only files and the owning non-root host UID. pnpm check passed 171 unit/policy/config/crypto tests; pnpm test:db passed 43 integration cases plus migration rollback/tamper checks, including ciphertext/wrong-org denial, foreign IDs, viewer/child restrictions, CSRF/Origin, rewrap after old-key removal, optimistic conflict, revocation and concurrent authority locking. Isolated setup verified mode 0600, preservation across repeat runs and Compose override validation. No main-installation provider secrets were created and no provider network requests were sent. Next: CL-02-03 bounded Ollama transport with DNS/address pinning and local-only model evidence.
- UI: http://127.0.0.1:3000/account. Preserve the real installation and its ignored local credentials/volumes. Tests use disposable fixtures, never claim the user's owner account.
- Branch/remote: main → https://github.com/coldbathcode/craftlayer.git; see [build log](build-log.md) and Git for each task publication.
- Chapters 03–11 remain unimplemented; no paid inference, live provider calls, public deployment or Cloud implementation.

## Continuity

Read [Chapter 02](../chapters/02-provider-gateway.md), [ADR 0013](../architecture/decisions/0013-provider-gateway-boundary.md), current source and the exact next task before continuing. Preserve the unchanged source blueprint. Never claim unexecuted checks passed.
