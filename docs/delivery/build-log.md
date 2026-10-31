# Build log

Every entry records an independently committed/pushed build step on `main`. Exact commits are available with `git log --oneline --grep=CL-00`.

## CL-00-01 — 2026-10-31

Pinned local Node/pnpm and selected exact library versions in ADR 0011. Inspected official multi-architecture image indexes and stored immutable digests. `node --version`, `pnpm --version`, package metadata and image manifest checks passed. Application install/build checks belong to CL-00-02 onward; Minecraft authentication and amd64 execution remain unverified. Added the standing plan-update/commit/push requirement to both agent entry points.

## CL-00-02 — 2026-10-31

Created the pnpm workspace, strict TypeScript project references, core/context and health contracts, Vitest and Biome configuration, and AST-based dependency-boundary checking. `pnpm lint`, `pnpm build`, `pnpm test` (3 tests), and frozen-lockfile install passed. An intentional web-to-db import was rejected. Corrected initial test discovery to exclude dependency sources and excluded Markdown from autoformatting; the original blueprint hash remains unchanged. Vite 8.3.5 is explicitly pinned to satisfy Vitest peer requirements.

## CL-00-03 — 2026-10-31

Added Drizzle organization/project schema, SQL migration/checksum runner, separate migration/runtime roles, forced RLS, transaction-local tenant context and scoped project reads. `pnpm build`, `pnpm lint`, unit checks and `pnpm test:db` passed; the disposable PostgreSQL 18.6 instance passed 6 real-runtime-role tests covering DDL/role denial, missing context, pooled A/B contexts, forged writes, rollback/timeout cleanup and composite foreign keys. Fresh migration and repeat migration both passed. Resolved a Docker Desktop bind-mounted initialization-script execution failure by baking the nonexecutable init file into a pinned PostgreSQL image; no host database was modified.

## CL-00-04 — 2026-10-31

Built Fastify health/OpenAPI and sanitized correlated error responses, strict server config and credential-redacting Pino logs, worker health/shutdown shell, CLI help/config validation and an original responsive Next.js foundation dashboard. `pnpm lint`, `pnpm typecheck`, `pnpm test` (8 tests) and production `pnpm build` passed. Process smoke checks against unavailable local dependencies verified API/worker liveness 200, readiness 503, SIGTERM exit 0 in 6ms each, and no credential canary in logs; valid CLI config passed and missing config correctly returned exit 1. Next telemetry is disabled in project scripts; no remote fonts/assets are used. Full browser and Compose connectivity are verified in subsequent tasks, not claimed here.

## CL-00-05 — 2026-10-31

Built pinned multi-stage production images and the private Compose stack, generated independent random .env credentials (0600, Git-ignored), and added optional loopback-only host-development DB/Redis ports. `docker compose build`, Compose validation, real startup and all five service health checks passed; migration completed as its dedicated role. Browser navigation verified the live dashboard and Core API connected state at http://127.0.0.1:3000. API external egress was denied on the internal network; only web has an ingress network and host port 127.0.0.1:3000. Native frozen-lockfile pnpm deployment required injected workspace dependencies synchronized after topological package builds; replaced legacy deployment rather than allowing re-resolution. Unit/lint/CLI config checks passed. No Minecraft/Ollama/provider service or account is required.

## CL-00-06 — 2026-10-31

Added SHA-pinned least-privilege GitHub Actions, strict test-source typechecking, package-boundary regression tests, API/worker lifecycle tests, sanitized request-log tests, disposable migration rollback/checksum checks, full-stack hardening checks, and desktop/mobile Playwright journeys. Local `pnpm check` passed (12 unit tests), database integration passed (6 tests plus rollback/tamper checks), browser suite passed (4 tests), and `pnpm test:offline` passed all 12 unit tests as a non-root user with network=none and a read-only filesystem plus scoped temporary caches. Stack checks confirm private ports and no DB/Redis credentials in web. CI is authored but its first hosted run is pending this commit/push; task acceptance remains pending that result.

## CL-00-07 — 2026-10-31

Completed developer quickstart, compatibility/resource matrix, foundation review and next-session handoff. Hosted Ubuntu amd64 CI passed all steps for code baseline caa37cb: https://github.com/coldbathcode/craftlayer/actions/runs/41216814943 . A new GitHub clone passed frozen install, pnpm check and production build, then booted an independently named private Compose stack on port 3301 and passed stack hardening plus all 4 browser tests. Its disposable volumes/containers were removed; the main local preview remains at 127.0.0.1:3000. Local evidence: 12 unit tests, 6 DB integration tests plus migration rollback/tamper checks, 4 browser tests, and 12 offline unit tests. Idle five-service memory sample was about 182.5 MiB on the documented arm64 host; this is not a load/capacity guarantee. Chapter 00 is implemented and verified, ready for owner review; stop here. Next task is CL-01-01 after Chapter 01 authorization. Standing plan-update/commit/push instructions are present in both agent guides and the quickstart.

## CL-01-01 — 2026-10-31

Implemented identity/session/membership/role/grant/invitation/reset/audit schema, immutable permission templates, forced tenant RLS and composite role/world FKs. Added a dedicated non-owner identity role, column-restricted identity updates and owner/child safety triggers; runtime cannot read global identities. Added a one-shot owner provisioner and additive local secret setup for existing installations. `pnpm check` passed (12 unit tests); `pnpm test:db` passed 10 DB tests plus migration rollback/checksum checks. Fresh and repeat migrations passed. Existing local Compose upgrade, role provisioning and all five service health checks passed without replacing existing passwords. Login/session/API behavior is not yet implemented.

## CL-01-02 — 2026-10-31

Implemented restricted-pool auth service, atomic one-time bootstrap, Argon2id password hashing, opaque hashed sessions, login rotation, idle/absolute expiry, logout/session revocation, persistent throttles, exact Origin checks and session-bound CSRF. Cookies are HttpOnly/SameSite=Strict and Secure on HTTPS; HTTP configuration is limited to loopback. `pnpm check` passed (13 unit tests); disposable database suite passed 16 integration tests, including bootstrap race, fixation/rotation, expiry, throttles, Origin/CSRF and HTTPS-cookie cases, plus migration rollback/tamper checks. Local synthetic Argon2id hash/verify each measured 9ms at 19MiB/t=2/p=1. Production Compose upgrade and all service health checks passed; setup remains unclaimed (no test owner created in the real local installation). Future authorization/invitation/recovery workflows are not yet implemented.

## CL-01-03 — 2026-10-31

Added table-driven permission/account/scope policy, canonical project/world lookup, membership-derived authority, transactional guards, filtered lists and owner-only organization creation. Child ceilings apply even with an extra admin role and reject coding/research worlds; Builder execution needs explicit scoped delegation. Added signed, expiring execution grants bound to user/membership versions, exact resource and originating session; grants are internal primitives, not a running worker engine. `pnpm check` passed (156 unit/policy tests); disposable DB suite passed 21 integration tests including cross-org IDs, filtered reads, admin vs instance owner, tamper/logout grant denial and HTTP permission/body-scope negatives. All queries remain parameterized and tenant-context checked.

## CL-01-04 — 2026-10-31

Implemented single-use, expiring/revocable invitations (including existing adult account joins), current-inviter permission checks, scoped member/role administration, bounded custom-role delegation, membership suspension, resource-grant removal and instance-owner-only global disable/restore. Role/scope changes bump membership authority versions; global disable revokes sessions. Last active instance owner and last adult org admin are protected. Added append-only, bounded audit detail columns without changing applied migrations. `pnpm check` passed (156 unit/policy tests); disposable DB suite passed 27 integration tests plus migration rollback/tamper checks, covering invite replay/races/expiry, role escalation, membership-vs-user disable, grant revocation, multi-org joins and last-owner/admin protections.

## CL-01-05 — 2026-10-31

Added optional TLS SMTP recovery with generic responses, hashed single-use 30-minute reset tokens and an encrypted/fenced/bounded mail outbox (disabled by default). Added local owner credential recovery via hidden/stdin CLI input, session/version invalidation, adult-created child accounts without email, assigned Minecraft-only access and adult-managed child password reset. `pnpm check` passed (157 unit/policy/config tests); disposable DB suite passed 32 integration tests plus migration rollback/tamper checks, including encrypted-token storage, reset races/replay/expiry, delivery retry limits, CLI stdin recovery, disabled-account preservation, child role/world restrictions and session revocation after password change. No real email was sent; tests use local delivery fakes. Outbox/session secrets remain outside browser, logs and Git.
