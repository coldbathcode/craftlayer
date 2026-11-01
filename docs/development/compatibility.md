# Foundation compatibility matrix

Recorded 2026-10-31. Exact dependency resolutions live in `pnpm-lock.yaml`; immutable official image index digests live in `infra/images.lock.json`. [ADR 0011](../architecture/decisions/0011-foundation-toolchain.md) explains choices.

| Component | Pin | Compatibility / evidence |
| --- | --- | --- |
| Node | 22.23.3 | Local arm64 and Docker execution; supported LTS line; meets selected framework engines |
| pnpm | 10.23.0 | Exact packageManager and Docker Corepack activation; frozen install and native production deploy |
| TypeScript | 5.9.3 | Strict project-reference builds plus independent test-source typechecking; major 7 deferred |
| Next / React | 16.4.3 / 19.3.1 | Production standalone build; generated route types before checks; browser tests on desktop/mobile |
| Fastify / Zod | 5.12.7 / 4.6.7 | App injection and live HTTP; typed response validation and generated OpenAPI |
| Drizzle / pg | 0.45.4 / 8.23.1 | Actual PostgreSQL RLS, context, composite-FK and role tests |
| PostgreSQL | Image reports 18.6 | Fresh/repeat/failure migrations and actual restricted-role integration |
| Redis | Image reports 8.10.3 | Authenticated internal connection, persistence volume and API/worker readiness |
| Pino | 10.4.0 | Credential canaries and sanitized request logging checks |
| Argon2 | @node-rs/argon2 2.2.2 | Argon2id 19,456 KiB/t2/p1; native arm64 local/container and amd64 CI qualification tracked in identity review |
| Optional SMTP | Nodemailer 10.3.1 | Verified TLS and bounded delivery; local fakes exercised, real SMTP unverified |
| Vitest / Vite | 5.0.5 / 8.3.5 | 188 tests on host and network-disabled read-only non-root container |
| Biome | 2.6.4 | Warning-free source formatting/lint; source Markdown excluded from automated rewrites |
| Playwright | 1.64.1 | Chromium desktop and mobile viewport suites; WebKit/Firefox not claimed |
| Mineflayer | Metadata inspected at 4.39.0; not installed | Requires Node >=22; actual Java/game/auth/pathfinder selection and testing remain Chapter 04 |
| BullMQ | Not installed | Queue execution/recovery starts Chapter 03; foundation Redis is connectivity only |
| Provider transport | Node 22 native HTTP/TLS, no SDK | Chapter 02 bounded protocol/failure contracts and synthetic database/Compose qualification; real server/model versions unverified |
| Java / Ollama | Not installed or required | Minecraft remains Chapter 04; Chapter 02 Ollama contracts use fakes, live inference/hardware deferred |

## Platforms and capacity

Local validation host: macOS arm64, 14 logical CPUs, 36 GiB host RAM, Docker Engine 28.2.2 and Compose 2.36.2. Container memory limits total 1,664 MiB for the five long-running foundation services; migration has an additional temporary 256 MiB cap. This is a configured ceiling, not minimum required host memory.

One idle sample after health/browser checks: API 43.83 MiB, PostgreSQL 35.55 MiB, Redis 12.07 MiB, web 53.84 MiB, worker 37.18 MiB (about 182.5 MiB total). Reported CPU was 0–0.28% per container. This is a single idle observation, not a load benchmark or small-hardware guarantee. Minecraft and local inference add separate unmeasured costs.

Official image indexes contain amd64 and arm64 variants. Hosted Ubuntu amd64 execution is tracked by the linked CI evidence in [the chapter review](../reviews/00-foundation.md); manifest presence alone does not count. Native Windows, Intel N150 performance, game server versions, real model APIs and production upgrades are not validated by this foundation.

## Pin updates

Change exact package versions/lockfile and image references together; re-run impacted builds/contracts/integration/browser/offline checks. When image pins change, update both Dockerfiles/Compose references and `images.lock.json`. Review current security advisories and dependency/image license obligations before release. Core's license choice and Redis/dependency license review remain open; this matrix makes no legal compatibility claim.
