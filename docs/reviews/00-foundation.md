# Chapter 00 — Foundation review

Implementation: all seven foundation tasks delivered; final acceptance review pending project-owner review. Date: 2026-10-31. Implementation/check author: Codex. Code evidence baseline: `caa37cb`; final quickstart/status documentation is recorded in the CL-00-07 commit. No claim of independent human security review.

## Delivered behavior

A fresh checkout runs a private Next dashboard, Fastify API/OpenAPI, worker shell, PostgreSQL and Redis with automatic migration. Application DB access uses a restricted non-owner role with forced RLS and explicit transaction-local organization context. CLI validates config without revealing values. Core has no Cloud/provider-account dependency.

Accounts, sessions, memberships/RBAC, provider calls, task scheduling, emergency-stop orchestration, actual game bots, coding/research and backups remain later chapter work. No tenant-data mutation HTTP routes are exposed before auth exists.

## Task and requirement evidence

| Task / requirement | Delivered evidence | Result |
| --- | --- | --- |
| CL-00-01 | ADR 0011; exact Node/pnpm/dependency pins; official image indexes | Pass; actual game compatibility deferred to 04 |
| CL-00-02 | Strict TS workspace; lint; AST boundary check including negative imports; frozen install | Pass |
| CL-00-03 / PR-003 | Fresh/repeat DB migrations; restricted role, RLS, pooled context, rollback/timeout, foreign writes and composite FK | 6 integration tests pass |
| CL-00-04 / PR-017 | Validated/redacted config, health/OpenAPI, CLI, API/worker SIGTERM and preview web | 12 total unit/lifecycle/boundary tests pass |
| CL-00-05 / PR-001 | Production Compose startup, dedicated migration, non-root healthy services, private ports, no web credentials | Pass; API external egress blocked |
| CL-00-06 / NFR-09 | CI, browser and offline tests; migration rollback/checksum rejection | Local and hosted checks pass |
| CL-00-07 | Fresh GitHub clone install/check/build and isolated-stack recipe; quickstart/compatibility/handoff | Evidence recorded in build log |

## Commands executed

- `pnpm install --frozen-lockfile`: pass in original and fresh GitHub checkout.
- `pnpm check`: lint/boundaries + strict source/test typecheck + 12 tests + docs integrity pass.
- `pnpm build`: production packages/Next pass on original and fresh checkout.
- `pnpm test:db`: 6 integration tests plus fresh/repeat migration, failure rollback and checksum tamper checks pass in a disposable PostgreSQL instance.
- `pnpm compose:check`, `docker compose build`, `docker compose up -d --wait`, `pnpm check:stack`: pass; five running services healthy, migrator exited zero.
- `pnpm test:offline`: 12 unit tests pass with external networking disabled, non-root user and read-only filesystem with narrowly scoped temporary caches.
- `pnpm test:e2e`: 4 Chromium tests pass across desktop/mobile configurations, checking live/unavailable states, keyboard skip link, no overflow/errors/external requests and OpenAPI.
- `pnpm cli --help`, valid `.env` validation: pass; invalid config returns exit 1 without echoing credentials.
- API/worker process smoke: liveness 200, dependency-unavailable readiness 503, clean SIGTERM exit 0 measured at 6 ms each in the local smoke.
- `git diff --check` and documentation/source hash checks: pass at each recorded checkpoint.

Hosted CI: [Foundation checks for caa37cb](https://github.com/coldbathcode/craftlayer/actions/runs/41216814943). Result: **success** on Ubuntu amd64; every required workflow check passed. Final documentation commit triggers the same workflow again.

## Security and failure review

Runtime role cannot DDL, assume migrator role or read migration metadata; migration role owns tenant tables and both forced-RLS flags are asserted. Missing context denies rows; invalid/foreign writes fail. A/B contexts and rollback/statement timeout are tested on a pool of one physical connection. Migration errors roll back DDL; changing an applied file refuses migration.

No raw dependency errors, URL query credentials or authorization headers enter public responses/request logs in tested cases. Web has no DB/Redis/migration secrets. No Docker socket/privileged container. Stop here is process shutdown only: the mission emergency-stop protocol is Chapter 03 and is not advertised as implemented.

Default API/worker/data network has no external route; web has separate loopback ingress. Browser tests block/report any non-loopback request. No inference, external deployment, telemetry enrollment or package/image publication occurred. Git pushes were explicitly authorized by the user.

## Usability, performance and limits

Desktop and 390px mobile layouts reviewed in Chromium; skip navigation and status announcement region verified. Full screen-reader/WCAG review is Chapter 05 work. Fonts/illustration are local; no third-party font/image requests. [Compatibility notes](../development/compatibility.md) record host and a single idle memory sample; no load, N150, Minecraft or inference capacity claim is made.

Local secrets are mode-0600 `.env`; preserving the file/volume association is essential. Redis reconnection currently requires service restart. Auth and safe remote sharing are not present; preview binds loopback. Backup/restore, provider pricing, sandbox security and release licensing are not established by this chapter.

## Review checkpoint

All implemented behavior should be reviewed against this evidence before authorizing Chapter 01. Project-owner acceptance is pending; this record does not self-approve the chapter. Next task: **CL-01-01**, identity schema and role seeds. Preserve the standing update-plan/commit/push requirement at every subsequent build step.
