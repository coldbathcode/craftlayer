# Foundation developer quickstart

Chapter 00 provides a local foundation preview: dashboard, API/OpenAPI, worker shell, CLI configuration checks, PostgreSQL organization isolation and Redis connectivity. Accounts, RBAC, mission execution, model routing and Minecraft are later chapters. Do not expose this preview as a public service.

## Prerequisites

- Node 22.23.3 (`.node-version` / `.nvmrc`) and pnpm 10.23.0 (`packageManager`). Use an existing version manager to select the pinned Node release.
- Docker Engine and Docker Compose v2, running. Verified locally with Docker Desktop on macOS arm64; hosted CI validates Ubuntu amd64. See [compatibility](compatibility.md) for exact evidence.
- Python 3 for documentation checks. No provider key, Java installation, cloud account or paid service is needed for the foundation.
- Port 3000 free on loopback. Set `CRAFTLAYER_HTTP_PORT` in `.env` before starting to choose another unprivileged port.

## Start the full stack

```bash
git clone https://github.com/coldbathcode/craftlayer.git
cd craftlayer
corepack enable
corepack prepare pnpm@10.23.0 --activate
pnpm install --frozen-lockfile
pnpm setup:local
pnpm compose:check
pnpm stack:up
```

Open **http://127.0.0.1:3000**. The page should show **Core API connected**. `stack:up` builds local production images, starts PostgreSQL/Redis, applies migrations using the dedicated migration role, then waits for API/worker/web health. First build retrieves dependencies/images; subsequent builds reuse layers. Installation requires dependency network access; the running Core API/worker/data network has no external route.

`setup:local` creates `.env` with independent database/Redis passwords and bootstrap/recovery/CSRF secrets and mode 0600. Repeating it keeps existing values. Never copy the blank `.env.example` values into an active deployment. Retain `.env` with its associated volumes: changing passwords in a file does not rotate already-created PostgreSQL roles. No secrets are printed by the setup script.

Only web publishes a default host port, bound to `127.0.0.1`. API/worker/PostgreSQL/Redis stay private. Web has a separate ingress network and the internal API network; it receives no DB/Redis/migration credentials. LAN/TLS/remote access is intentionally not enabled by this quickstart.

## Inspect health and contracts

```bash
pnpm check:stack
curl --fail http://127.0.0.1:3000/health/live
curl --fail http://127.0.0.1:3000/api/v1/system/status
curl --fail http://127.0.0.1:3000/api/v1/openapi.json
pnpm cli --help
pnpm cli config validate .env
docker compose ps
docker compose logs --tail=30 api worker web
```

`/health/live` on the published edge is web liveness. `/api/v1/system/status` is API readiness (schema present and Redis responding), not a mission endpoint. Direct internal API/worker health exposes liveness separately from dependency readiness. Public responses omit connection details.

Do not print `docker compose config` without `--quiet`, dump container environment, or paste `.env` into diagnostics: those outputs can contain credentials. Inspect service state and redacted logs instead.

## Verification commands

| Command | What it verifies |
| --- | --- |
| `pnpm check` | Warning-free lint, dependency boundaries, strict source/test typechecking, unit checks and Markdown structure |
| `pnpm build` | Topological server packages plus production Next build; injected workspace dependencies are synchronized after package builds |
| `pnpm test:db` | Fresh disposable PostgreSQL, separate roles, repeat migration, identity/API/RLS/integrity tests, failed-migration rollback and checksum tamper denial |
| `pnpm compose:check` | Compose configuration without displaying secrets; requires generated `.env` |
| `pnpm check:stack` | Five healthy non-root services, private ports, capability/memory limits, web secret separation and same-origin API |
| `pnpm test:offline` | Builds test image, then runs unit/lifecycle tests as non-root with network disabled and read-only root; temporary caches are isolated |
| `pnpm exec playwright install chromium` | One-time local browser download |
| `pnpm test:e2e` | Desktop/mobile connected/error states, no page exceptions or external requests, keyboard skip and no horizontal overflow; stack must be running |
| `pnpm test:identity-ui` | Full account journeys on an isolated random-port installation; removes its own volumes and preserves your owner setup |
| `pnpm docs:check` | Chapter/task/link/source-hash integrity only |

`pnpm test:integration` is the lower-level suite and requires `TEST_DATABASE_URL` pointing at a correctly provisioned disposable restricted-role database. Prefer `test:db`, which owns and removes its container/volume. Do not point tests at a real installation.

## Host-based editing

Run the production stack first to validate your environment. To edit with local Node processes, stop container app processes and publish only the development data ports:

```bash
docker compose stop api worker web
docker compose -f docker-compose.yml -f infra/compose/development.yml up -d postgres redis
pnpm build:server
pnpm db:migrate
```

In separate terminals:

```bash
pnpm dev:api
pnpm dev:worker
pnpm dev:web
```

Development web listens on loopback port 3000 and proxies to local API port 4000. Host URLs in `.env` use loopback PostgreSQL 55432 and Redis 56379. Server entry points load root `.env`; Next uses its server-side default API origin locally. Never place credentials into a `NEXT_PUBLIC_*` variable. Rebuild affected shared packages after changing their public exports; the injected workspace copies synchronize on package `build`.

To return to full Compose, stop the local Node processes, then `pnpm stack:up`. The optional host data ports may remain on already-created containers until recreated; remove the development override and recreate the data services when returning to private default bindings. Verify with `docker compose ps` and `pnpm check:stack`.

## Stop, persistence and recovery limits

```bash
pnpm stack:down
```

This stops/removes this project's containers and networks while retaining database/Redis volumes and `.env`. Restart with `pnpm stack:up`. Avoid deleting volumes unless intentionally discarding this installation's data. Automated backup/restore and production upgrades are Chapter 09 work; do not mistake foundation volume persistence for a backup system.

If port 3000 is occupied, change `CRAFTLAYER_HTTP_PORT` and the matching `CRAFTLAYER_PUBLIC_URL`, then recreate API and web. If readiness fails, inspect migration status and redacted API/worker logs. A lost Redis connection currently remains unavailable until service restart; later runtime chapters add reconciliation. Never solve a connection problem by switching application DB URLs to the admin role or publishing DB ports publicly.

## Build-step workflow

Before editing, inspect Git status and current delivery status. At the end of every build step, run relevant checks, record task evidence and the exact next action, commit the task changes, push to `origin main`, then verify remote/local equality. This is the user's standing requirement in [AGENTS.md](../../AGENTS.md). Chapter boundaries still require authorization for the next chapter.

Open `/account` for first-owner setup and account administration. Follow the [identity/recovery runbook](identity-and-recovery.md); implementation tests leave your installation unclaimed.
