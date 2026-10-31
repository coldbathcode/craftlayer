# Chapter 01 review — Identity and RBAC

**Implementation state:** implemented and locally verified. **Acceptance decision:** pending owner review. **Reviewer:** implementation self-review by Codex; independent review unassigned. **Date:** 2026-10-31 UTC. **Commit/tree:** task commits `35fa64d`, `141e0a4`, `87fc5e3`, `d4f52df`, `f239cd4`, `f3ae8ea`, followed by the CL-01-07 review commit containing this file. **Authorized scope:** the user's “do the next bit” authorized Chapter 01 after the Chapter 00 checkpoint. Chapter 02 is not authorized.

## Delivered behavior

The unclaimed local installation can now bootstrap one owner, sign in local adults/children, manage organizations and scoped memberships, invite adults, assign Minecraft worlds, suspend/restore memberships, disable/restore identities as owner, revoke sessions and recover passwords without Cloud. The responsive `/account` console operates the identity slice; adding project/environment metadata does not connect bots or providers.

PR-002–004, PR-021 and NFR-08 are covered for the identity boundary. This does not claim the later runtime, complete Kid Mode or production release portions of those requirements. [ADR 0012](../architecture/decisions/0012-identity-boundary.md) records the privilege boundary, library choices and scoped deviations. [The runbook](../development/identity-and-recovery.md) explains real owner setup, protected recovery, administration and optional SMTP.

## Implementation inventory

`packages/auth` owns sessions/recovery/authorization; `packages/core` owns pure permission policy; `packages/db` contains schema/migrations and scoped persistence. Shared public identity schemas live in `packages/contracts` and browser transport in `packages/sdk`. `apps/api`, `apps/cli` and `apps/web/src/app/account` expose the scoped interfaces. Compose/provisioning, scripts, tests and CI enforce private deployment and disposable verification. Derived plans, ADR 0012, runbooks/status/backlog and this handoff are updated; the original blueprint is unchanged. Inspect the complete changed-file inventory with `git diff --stat 4df5e20..HEAD`.

## Acceptance evidence

All commands execute from repository root. Fixtures are disposable, generated locally and contain no real recipients, worlds, provider credentials or paid inference.

| Task / criterion | Exact command or procedure | Result / exit | Evidence and coverage |
| --- | --- | --- | --- |
| CL-01-01 / schema, role seeds, tenant references | `pnpm test:db` | PASS / 0; 39 integration cases plus migration negatives | Actual PostgreSQL roles; repeat migrations; runtime cannot read global identities; identity cannot DDL/bypass RLS; cross-org FK and child-owner denial |
| CL-01-02 / bootstrap, hashes, session lifecycle | `pnpm test:db` | PASS / 0 | One winner in concurrent bootstrap; native Argon2id encoded parameters; fixation/rotation, throttles, cookie/Origin/CSRF, idle/absolute expiry and revocation |
| CL-01-03 / role, scope and child ceilings | `pnpm check` | PASS / 0; 159 unit/config/contract cases | 140 role/permission fixtures plus policy edge cases; each matrix row checks granted, missing, wrong-world and wrong-project scope; children also deny coding/research |
| CL-01-03–04 / current execution authority | `pnpm test:db` | PASS / 0 | Exact-world signed grant binding; tampering/stale version/revoked session denial; role and resource-grant invalidation; suspension and restore cannot revive old grants |
| CL-01-04 / invitations and lifecycle | `pnpm test:db` | PASS / 0 | Invite consume race/replay/revoke/expiry, inviter authority loss, existing adult join/rotation, membership versus global disable, last owner/admin and delegation ceilings |
| CL-01-05 / local recovery, optional mail and children | `pnpm test:db` | PASS / 0 | Reset expiry/replay/concurrent consumption; encrypted outbox and bounded failures; local CLI with stdin in an environment without `.env`, runtime DB or Redis settings; disabled status preserved; child world/role restrictions and adult reset |
| CL-01-06 / safe API, SDK and audit | `pnpm check` and `pnpm test:db` | PASS / 0 | Shared strict projections reject private fields; same-origin SDK refuses redirects; transactional allowed audit and restricted denial audit; no foreign names/global totals in scoped API lists |
| CL-01-06–07 / browser account journeys | `pnpm test:identity-ui` | PASS / 0 | Disposable random-port Compose installation: setup, login, child mobile world view, direct administrative denial, adult invitation, scoped grant assignment/removal, membership suspension, session revocation without active membership, child recovery and logout |
| CL-01-07 / concurrent permission change | `pnpm test:db` | PASS / 0 | Concurrent self-demotions serialize; exactly one succeeds and one returns LAST_ORG_ADMIN; concurrent owner disables preserve one active recoverable owner |
| CL-01-07 / pooled context cleanup | `pnpm test:db` | PASS / 0 | Runtime and identity connections reused across A/B/A; commit/rollback/timeout do not leak context; explicit `current_user` assertions |
| Production builds | `pnpm build`; `pnpm stack:up` | PASS / 0 | Strict TypeScript projects and Next standalone build; migrations and five healthy services |
| Private deployment and credential separation | `pnpm compose:check`; `pnpm check:stack` | PASS / 0 | Loopback-only web port, non-root/capability/memory constraints, no Docker socket; worker/web exclude identity/migration credentials |
| Foundation browser regression | `pnpm test:e2e` | PASS / 0 | Four desktop/mobile positive/error/keyboard/no-overflow cases; two isolated-identity entries intentionally skip in this command |
| Local operation without external network | `pnpm test:offline` | PASS / 0 | Unit/lifecycle suite in non-root, read-only container with network disabled |
| Actual local secret values absent from source/public JS | `node scripts/check-local-secrets.mjs` | PASS / 0 | Reads protected values only in memory and compares source/public bundles; does not print values; supplements schema/log canaries rather than replacing a general secret scanner |
| Documentation and input preservation | `pnpm docs:check`; `git diff --check` | PASS / 0 | Local links, 12 chapters, 84 task IDs, original blueprint SHA and clean diff |

Local host: macOS arm64, Node 22.23.3, pnpm 10.23.0, Docker Engine 28.2.2 / Compose 2.36.2. TypeScript 5.9.3; Next 16.4.3 / React 19.3.1; Fastify 5.12.7; Zod 4.6.7; Drizzle 0.45.4 / pg 8.23.1; native Argon2 2.2.2; Nodemailer 10.3.1; Vitest 5.0.5; Playwright Chromium 1.64.1. Pinned PostgreSQL image reports 18.6 and Redis 8.10.3. Exact resolutions and image digests remain in lockfiles/Compose and the compatibility matrix.

Hosted Ubuntu amd64 evidence: [CL-01-04 CI](https://github.com/coldbathcode/craftlayer/actions/runs/41251581388) passed. [CL-01-05 CI](https://github.com/coldbathcode/craftlayer/actions/runs/41252240754) exposed the unrelated-config dependency in owner recovery; CL-01-06 fixed it and its clean-environment regression passes locally. [CL-01-06 CI](https://github.com/coldbathcode/craftlayer/actions/runs/41253438079) passed the full pipeline, including recovery and isolated browser tests. The CL-01-07 publication also receives a fresh run; inspect that commit’s GitHub checks for its final hosted result.

The final review found and fixed empty DELETE requests carrying an inappropriate JSON content header in the SDK; browser tests now revoke resource grants and the current session after membership suspension. It also moves personal session controls outside the active-organization view. Browser suites have separate report/artifact directories, and the disposable harness overrides inherited credentials and removes its generated images/volumes. The inherited bootstrap canary run passed, verifying fresh test credentials rather than inherited personal configuration.

## Safety and failure review

- Global identity state uses a private restricted auth-service pool. API routes receive operations, not the pool. Runtime cannot read users/sessions/reset tokens. Workers/web receive no identity credential. Tenant tables force RLS and composite tenant references; app-supplied org IDs do not confer membership.
- Passwords are salted Argon2id hashes (19,456 KiB, t2, p1, 32-byte output); opaque session/reset/invitation bearers are hashed. Session-bound CSRF and exact Origin protect mutations. HTTP is accepted only for loopback; shared origins require HTTPS. No generic credential GET, public owner recovery or child signup route exists.
- Instance ownership is separate from membership. Service operations load current identity, membership, resource and grants; child restrictions survive added roles and stale grants. Queued execution plumbing does not yet exist; Chapter 03 must integrate grant revalidation before effects.
- Organization writes serialize relevant membership/role operations and last-admin checks. Password reset locks identity/reset rows, consumes once and revokes sessions. Already completed effects cannot be undone by revocation, and later physical effects will require leases/fences/receipts.
- Successful changes and audit commit together. Denials use a restricted instance projection and do not log guessed foreign IDs or raw request URLs. Audit INSERT/SELECT privileges do not permit normal app mutation/deletion. A database/host administrator remains trusted.
- Recovery has no cloud/email dependency. Optional mail uses verified TLS and encrypted row-bound payloads, fenced leases, bounded batches/retries and pruning. No real messages were sent. Duplicate delivery after uncertain SMTP acknowledgement remains possible; token consumption is single use.
- Cost/provider, emergency stop, prompt tools, Minecraft connections and sandbox controls are not exercised because those features do not exist yet. Their invariants remain binding for their chapters; no broad execution authority is exposed by this identity build.

## Performance and user verification

A local synthetic sample measured about 9 ms each for native Argon2id hash/verify. At most two password jobs run concurrently per API process. This is not an N150/load/hosted performance claim. Login/reset/invitation buckets persist in PostgreSQL and use HMAC identifiers.

Chromium desktop and a 390×844 mobile child viewport exercise real HTTP and independent cookie contexts. Screenshots were inspected for labels, spacing, table containment and child control visibility; keyboard/overflow regression checks also run. These checks are narrower than a full accessibility audit. Real installation setup remains `required: true`; fixture accounts never claim the user's database.

## Known limitations and unresolved work

- The owner has not independently accepted this review. Chapters 02–11 remain unimplemented and unauthorized unless separately requested.
- No real SMTP, public TLS/proxy deployment, OIDC, OS keychain, Windows, Firefox/WebKit or reference low-power-host qualification. Recovery relies on preserving protected local settings and database state. Backups, pending-mail key rotation and production restore drills are Chapter 09.
- Identity lists are limited to 100 rows; cursor navigation, full admin search, global audit UI/export, request/correlation propagation and audit retention jobs remain later work (ADR 0012, D-23). The minimal UI is for small local installations. Account snapshots update on refresh/mutation; server authorization is immediate after commit.
- No native SDK execution client, mission engine, agent/world adapter, preset approval or full Kid Mode. The SDK currently shares strict response contracts and safe transport; generated endpoint methods can extend it later.
- The identity service is a trusted boundary with access to global identities. A fully compromised auth process or malicious host/DB administrator is outside the RLS application-error defense. A separate security review and dependency/image vulnerability triage remain release requirements.

## Review decision and handoff

- [x] Required task evidence complete and accurate.
- [x] All acceptance criteria met or explicit scope amendment reviewed.
- [x] No unresolved blocking safety/correctness issue identified by implementation checks.
- [x] Docs/backlog/status/ADRs updated consistently.

Decision: **pending owner review**, not independent security certification. Next task is **CL-02-01 provider/pricing contracts**, subject to Chapter 02 authorization. Read the [handoff](../delivery/handoffs/01-identity-and-rbac.md) and current status first. Every future build step must continue to update plans, commit, push `origin main` and verify synchronization.
