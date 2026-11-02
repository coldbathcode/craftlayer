# Minecraft deployment planning

Status: CL-F25-02 checkpoint A implements an effect-free preview only. [Node trust](minecraft-nodes.md), [ADR 0019](../architecture/decisions/0019-private-node-trust.md) and [F2.5 chapter](../chapters/F2.5-docker-provisioning.md) retain the physical execution and release gates. No Contabo access or existing world/container write is authorized by this feature.

## Try it

Start the [separate prototype](prototype.md) and its foreground read-only agent, sign in as the parent and open `/nodes`. Select a host, enter **Plan a Minecraft server**, choose its Minecraft world access scope, server name, Java TCP and Bedrock UDP ports, then **Preview deployment**. The scope is an existing logical environment, not a host path or existing world to overwrite. A future provision operation must create separate ownership-bound storage.

The preview shows a proposed 4 GiB Java heap inside a 6 GiB container, two CPUs, 2 GiB system memory headroom, 20 GiB enforced world storage, online authentication/enforced empty allowlist, no public RCON, no OPs/PvP/command blocks and daily backups with 14-day retention/weekly encrypted off-host protection. These are desired requirements; no setting, EULA, backup policy or game runtime is applied. The pinned Paper/Geyser/Floodgate artifacts reuse the existing **unqualified** identity candidate; the Java image is a base image, not an approved complete Minecraft server image. No latest tag, arbitrary image, plugin URL or host path is accepted.

Changing a field clears the old result. Previews expire after 30s. A passed row refers only to its stated read/calculation. No reported Docker conflict still leaves native host processes, firewall and reservations unverified. Unbounded container memory prevents free-capacity assumptions; stale/future/disconnected reports cannot qualify headroom or port availability. All incomplete image/identity/backup/quota/network/EULA/broker gates remain visible. **Server creation stays unavailable.**

## API and authority

- `GET /api/v1/server-templates?node_id=<uuid>` requires current adult `node:deploy` for the canonical project. Returns the bounded Family Survival candidate manifest.
- `POST /api/v1/servers/provision/plan` accepts exactly `node_id`, `environment_id`, `template_id: family-survival-v1`, `name`, `java_port`, `bedrock_port`. Ports are integer 1024–65535 for preview; actual deployment additionally requires an approved node port policy/reservation.
- The service checks current adult `node:deploy` on the node's canonical project and `server:provision` on the same-project Minecraft environment under one current identity guard. Children are denied even with an extra admin role. Default permissions belong only to Org Admin; custom roles need current permission and scoped grants. Foreign nodes/environments and cross-project/non-Minecraft placement are denied. Browser permissions supplement service checks.
- Cookie POST retains exact Origin/CSRF. Remote entry stays blocked pending private access/MFA qualification. REST/OpenAPI/Zod/SDK share schemas. No `/servers/provision` execution route, MCP provision tool, node command, queue or socket proxy is introduced.

The response includes thirteen checks, selected TCP/UDP conflicts, timestamps, template and plan digests; `effects: none`, `reservations_created: false`, `dispatch_available: false` are fixed. Exact scope/request/current actor-session-authority, node/key generation, report and template bind the 30s preview digest. It is not an approval token, durable operation or saved deployment. No allocation/idempotent effect is being promised; future business mutations must create durable operations and revalidate/approve the exact persisted plan. Arbitrary image/path/env/commands and claimed approval/EULA fields fail schema validation.

## Verification and remaining acceptance

`pnpm check` covers deterministic manifests/digests, strict fields, protocol/address conflict checks and unsafe capacity states. `pnpm test:db` covers actual RLS-scoped canonical placement/current permission revocation, child/viewer/tenant denial, HTTP/CSRF/schema/OpenAPI and absence of execution. Migration 0019 adds only permissions and upgrades existing admin roles; no existing migration is edited. `pnpm test:server-ui` runs production images plus actual local mTLS and synthetic capacity, tests changing an occupied Java port, clearing old preview and open readiness gates, then continues rotation/revocation and prior server flows. The running prototype additionally reports actual local Docker bindings; choosing its existing web port demonstrates a real conflict without mutation.

Still required: current signed job/lease/fence/replay journal; transactional CPU/RAM/disk/port reservations including native services; hard quota enforcement; complete vetted runtime image; independent adult approval and explicit EULA acknowledgement; ingress closed until real Java/Bedrock access and readiness are proven; backup scheduling/protection and successful isolated restore; ownership-safe rollback and crash reconciliation on disposable hosts. See [acceptance matrix](../testing/minecraft-management.md). None of those physical checks is marked passed by a preview.

## Rollback and backup boundary

Application rollback removes the preview UI/routes; additive permission migration/history can remain unused. This preview creates no container, network, volume, world, backup, reservation or deployment operation to remove. Do not drop shared tables, reset the prototype, prune Docker or edit migration checksums. Keep original installation data and retained node journals. Any future live write needs explicit operator approval and the [preservation/recovery procedure](../operations/minecraft-preservation.md), including verified restore and rollback that retains pre-existing worlds/backups. A desired daily-backup setting is not a recoverable backup.
