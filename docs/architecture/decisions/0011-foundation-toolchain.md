# ADR 0011 — Foundation toolchain and image pins

Status: adopted for Chapter 00 on 2026-10-31. Validated host: macOS arm64, Node 22.23.3, pnpm 10.23.0, Docker Engine 28.2.2 / Compose 2.x.

Use Node 22.23.3 (supported LTS and already installed), pnpm 10.23.0, TypeScript 5.9.3, Next 16.4.3, React 19.3.1, Fastify 5.12.7, Zod 4.6.7, Drizzle 0.45.4, pg 8.23.1 and Pino 10.4.0. Use Vitest 5.0.5, Biome 2.6.4 and tsx 4.23.15 for development. Pin exact dependencies and the pnpm lockfile. TypeScript 7 is available but deferred until its ecosystem compatibility is tested; foundation does not need a compiler-major migration.

Official image index digests for Node, PostgreSQL 18 and Redis 8 are recorded in `infra/images.lock.json`; all three indexes include linux/amd64 and linux/arm64. Local arm64 execution and hosted Ubuntu amd64 CI are verified in the Chapter 00 review; manifest availability alone is not execution evidence. Redis licensing must remain in the Chapter 09 dependency/license review; no Core license has been adopted.

Node 22 satisfies both Next's Node >=20.9 requirement and Vitest's >=22.12 requirement. Mineflayer 4.39.0 currently requires Node >=22; actual game protocol/auth/pathfinder compatibility remains a Chapter 04 gate and no game dependency is installed yet. BullMQ is deferred until Chapter 03 introduces real queue work; Redis connectivity in the foundation uses a bounded client.

Evidence: npm registry package metadata via `pnpm view`, official image manifests via `docker buildx imagetools inspect`, and local `node --version` / `pnpm --version`. Installation/build/runtime compatibility is verified by the completed foundation tasks and linked review. Java/game authentication remains unverified.

References: [Node releases](https://nodejs.org/en/about/previous-releases), [Next installation](https://nextjs.org/docs/app/getting-started/installation), [Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/), [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html). Recheck pinned versions/security advisories before release.
