# Deployment, resource management and recovery

Status: operational requirements for Chapters 00 and 09. Commands in the source blueprint are future target UX; this repository cannot yet run them.

## Supported initial topology

Reference deployment: private Ubuntu mini PC/VPS or Docker Desktop on macOS, API/web/worker/PostgreSQL/Redis in Compose, optional Minecraft and Ollama profiles. Windows is not an initial native support promise; a later WSL2 recipe may be documented after testing.

Start with 2 bots and a bounded seeded world. Record actual CPU, architecture, RAM, storage, Docker/Compose versions and server/mod versions. N150-class performance is unverified; local CPU inference competes with Minecraft and may need another host. Do not publish capacity numbers before the Chapter 06/09 benchmarks.

## Compose and network plan

- Default network exposes only the dashboard/API edge on loopback; bind LAN only through explicit configuration and TLS/private-network guidance.
- PostgreSQL/Redis are internal, authenticated where supported, and never published publicly. Minecraft port exposure is an explicit optional profile decision.
- Separate control, data and execution network access where practical. Untrusted coding/research runners cannot reach DB, Redis, metadata IPs or host services.
- Named volumes for DB, world and required artifact storage; no implicit ephemeral persistence. Define health checks, start-periods, restart/backoff policies and memory/CPU/PID limits.
- Run non-root app images, read-only filesystems where feasible, dropped capabilities, no privileged mode, minimal mounts and bounded log rotation.
- Setup creates secrets locally with restricted permissions; `.env.example` contains placeholders only. Missing critical secrets fail startup, never select a development default silently.
- No image auto-download, game license acceptance, paid model selection or remote access enablement hidden inside an agent mission.

Proposed starting resource profile to measure: Minecraft heap 2 GiB with container headroom, PostgreSQL 512 MiB, Redis 256 MiB, API/web combined 1 GiB, 2–3 worker bots 1 GiB plus host headroom. This is a budgeting hypothesis, not a tested minimum. Recommend an 8 GiB-class host only after a full-stack measurement confirms adequate margin; Ollama model memory is additional.

## Configuration inventory

| Category | Planned variables / source | Safety rule |
| --- | --- | --- |
| Instance | `CRAFTLAYER_PUBLIC_URL`, bind host, deployment mode | Validate URL/proxy assumptions |
| DB/queue | `DATABASE_URL`, migration URL, `REDIS_URL` | Separate runtime/migration privileges; never browser-exported |
| Identity | session/bootstrap secret references, optional SMTP config | No default passwords; setup token one-time |
| Encryption | credential key file/reference and key version | Key outside DB, protected backup required |
| Providers | optional provider env references and endpoint allowlist | Disabled until explicitly enabled; free-only defaults |
| Workers | identity credential, concurrency, lease/watchdog settings | Cannot widen authority from a job payload |
| Minecraft | host/port/version, bot auth mode, world/region policy | Compatibility probe, private network and PvP disabled |
| Limits | token/request/tool/runtime/storage/agent ceilings | Validate bounded values and policy intersection |
| Operations | retention, backup location, logs/metrics opt-in | No phone-home or telemetry default |

Environment-variable names are proposed; Chapter 00 establishes the canonical config schema and documents exact names. Never present this table as a ready-to-use `.env` file.

## Health and observability

Liveness checks process responsiveness. Readiness checks schema compatibility and required DB/queue availability without leaking connection strings. Workers report last heartbeat, lease count, event-loop lag and environment health. Ollama or Minecraft absence blocks related missions, not all identity/UI operations.

Pino JSON logs include service/version, request/trace, org/mission/task IDs where authorized, event code, latency and redacted error. Metrics: queue age, runnable/blocked tasks, lease expiry, stale fence rejection, stop acknowledgement/quiescence, model cooldown, reservation backlog, event replay lag, memory/CPU/storage. Avoid high-cardinality user IDs in metric labels. Raw prompts/responses are off by default.

Suggested alerts: worker unavailable while active, repeated lease expiry, oldest outbox item over threshold, stop unreachable past deadline, uncertain usage aging, storage/DB capacity, backup overdue and persistent model unavailability. Optional local observability profiles must work without vendor accounts.

## Backup and restore procedure to implement

1. Owner initiates maintenance/stop latch and drains bounded tasks; record unresolved effects.
2. Flush/snapshot Minecraft safely using server-supported save controls and capture world metadata.
3. Back up PostgreSQL, artifacts, validated config and image/schema manifest. Redis is reconstructable and must not be the only copy of work.
4. Back up encryption keys separately under strong access protection; verify key IDs without writing raw key bytes to manifests/logs.
5. Encrypt backup sets, hash files and upload/copy only to operator-configured storage. Retention defaults must be documented.
6. Restore into a new private stack, verify manifest/schema/key compatibility, run migrations only as documented, reconcile all leases/reservations and keep stop latches active.
7. Verify login/RBAC, decrypt a test credential without exposing it, inspect world and mission data, then explicitly clear stop and resume selected missions.

A successful backup command is insufficient: Chapter 09 must restore a nontrivial dataset on a clean host and measure RPO/RTO. Missing keys, corrupted archive, low disk and partially restored world/DB are required failure cases.

## Upgrade and rollback

Announce compatibility, back up, enter maintenance, drain, apply schema with migration role, deploy pinned images, check readiness and reconcile before resume. Test interrupted migration and mixed protocol versions. Forward-only DB changes may require restoring both DB/world from a coordinated backup; downgrading an image alone is not a universal rollback.

## Operational runbooks to ship

| Symptom | Safe first response | Do not do |
| --- | --- | --- |
| Stuck mission | Inspect reason/grant/lease/dependency and stop if uncertain | Force database state to succeeded |
| Provider 429/outage | Observe cooldown and eligible fallback; explain blocked state | Enable paid fallback automatically |
| Worker lost | Maintain stop/lease boundary; reconcile external effects | Blindly run the same destructive action |
| Redis loss | Rebuild dispatch from PostgreSQL/outbox with deduplication | Recreate missions from memory |
| DB unavailable | Stop new effects; restore connectivity and reconcile | Keep acting with cached unlimited authority |
| Secret suspected leaked | Stop affected scope, revoke/rotate, review redacted audit | Print secret for debugging |
| Child sees forbidden UI/data | Disable affected access and treat as security defect | Rely solely on hiding a menu |

Detailed executable runbooks are Chapter 09 deliverables and must identify commands for the pinned release.

## Unified family management scope

The opening planning-only description is historical: current Core Compose and local account/provider/simulation services exist as recorded in [status](../delivery/status.md). [Minecraft preservation/recovery](minecraft-preservation.md) is the planned F0–F3 procedure for in-place adoption, separately approved backup capture, daily/14-day/weekly off-host policy, isolated restore, save-on failure cleanup and ownership-safe rollback. Keep existing game Compose and world storage separate from CraftLayer. Never run installation/recovery commands on Contabo without explicit authorization, and never infer that adding server metadata starts or owns its container. Production network/TLS/MFA and recovery remain unverified. Chapter 09 extends these F-track runbooks for full Core DB/artifact/key upgrades instead of deferring family recovery until then.
