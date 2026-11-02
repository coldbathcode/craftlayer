# Minecraft observation service

F1 local preview, not family/production readiness. Existing local identity/organization/project/Minecraft environments are reused. Adoption writes CraftLayer metadata only; it never takes ownership of a Docker container/world or changes a game server. No Contabo access has occurred.

## Configure an operator-approved source

Default Core has no source or game connection. Set optional `CRAFTLAYER_MINECRAFT_INVENTORY_FILE` to an absolute protected JSON file owned by the API process, mode 0600, regular/non-symlink and at most 64 KiB. The parent directory must be operator-controlled. F1 supports at most 100 target bindings and four concurrent file reads/status queries per API process. Never put credentials, raw Compose/inspect output, world paths or Floodgate keys in this file. It contains approved game connection instructions and private player observations only; keep it outside Git, build context, public bundles and logs.

Empty valid configuration:

```json
{"schema_version":1,"targets":[]}
```

Each target follows strict `inventoryTarget` in `packages/contracts/src/minecraft.ts`: opaque `id`, canonical `organization_id`, Minecraft `environment_id`, label, immutable `binding_hash`, and typed `observation`. Bindings must be mapped by a trusted operator to the actual immutable container ID, data mount identity and world identity after authorized F0 inspection. The binding hash must not change with ordinary world content or observation timestamps. Do not invent a production identity from expected paths or a filename.

An observation carries ISO `observed_at`, `state` (`online|offline|unknown|unavailable`), Java/Bedrock game addresses or null, validated player names/edition or null, nullable captured online-auth/allowlist/RCON-public flags, and **false** `backup_verified`/`identity_verified`. Unknown is not false/zero/safe. Optional `java_status` supplies an approved literal private IP address, game port and explicitly operator-selected protocol version. No DNS/SRV, URL, arbitrary packet, RCON or credential input is accepted.

Use optional `infra/compose/minecraft-observation.yml` with explicit protected config directory and the API's non-root file-owner UID/GID. It mounts only that directory read-only into API, not web/worker. Base Compose remains unchanged/private. The optional source grants no network attachment to an existing game project; such attachment requires approved deployment/network planning. Replacing the JSON atomically is supported through a directory mount. Never edit/regenerate the real installation's secrets or deploy this override to Contabo under F1 local authorization.

## Observation semantics

Captured mode uses only protected local snapshots and clearly reports capture time. An explicit Observe operation can optionally send the fixed Java status handshake/request to a configured literal loopback/RFC1918/ULA game endpoint. Public, link-local/metadata, mapped IPv4, DNS and known admin ports are rejected. The request enters status state only, never login or command state. Responses/time are bounded (64 KiB, 1s), and only validated online player count is projected; untrusted descriptions/chat/icons/player samples are discarded. A status response cannot enumerate all players or prove online authentication/Floodgate/allowlist/RCON/backup policy, so those values remain unavailable/unknown. A failed query becomes unavailable and never starts the server.

Captures older than 60 seconds show stale, independently of server state. All views force `family_ready:false`. Source labels distinguish captured inventory from Java status. No model/provider is required. Actual Paper/Geyser/Floodgate clients, compatibility, world preservation, port/edge isolation, allowlist enforcement and game backup/restore remain unverified production gates.

## API, permissions and recovery

All paths under `/api/v1`; running OpenAPI is 3.1 using the pinned Zod/Fastify transform. New typed SDK endpoint methods reuse strict public schemas and the same-origin transport.

- `GET /server-targets?environment_id=…`, `POST /servers/adopt/plan`, `POST /servers/adopt`: current adult `server:adopt`, explicit environment and operator target; exact binding plan hash before registration. Plan is a non-mutating preview. Adopt returns durable operation/server IDs with 202.
- `GET /servers?environment_id=…[&cursor=…]`, `/servers/:id`, `/status`: explicit `server:read`; 50-row keyset pages, foreign scope/cursor denied.
- `GET /servers/:id/players`, `/activity`, `GET /operations/:id`: current scoped `player:read`, `audit:read`, `operation:read` respectively; bounded projections, no raw config/logs/credentials.
- `POST /servers/:id/observe`: current adult `server:observe`, expected version and UUID Idempotency-Key; durable running operation/fence before bounded I/O outside auth/SQL locks; authority, registration, version/fence/deadline rechecked before committing snapshot.
- `POST /servers/:id/unregister`: adult `server:adopt`, expected version/idempotency. Removes only registration metadata, retaining history and immutable target; fences observations. A new approved adoption of the same exact binding can reactivate that metadata; changing the binding is refused.

Every mutation is atomic with audit/reference-only outbox and current-authority replay checks. HTTP-generated request UUID correlates audit entries and `X-Request-Id`. New writes are capped at twelve operations per actor/environment/minute and 10,000 retained operations/environment; no silent pruning. This small-preview limit needs later retention supervision. Read-only observations are permitted during bot stop latches; they cannot dispatch bot/server mutations or clear stop.

Interrupted observation retains durable running state until expiry and reports `recovery_required`; the next authorized observation retires expired attempts, increments the resource fence and reads again. Observation I/O has no physical mutation to repeat. Old results, unregister or creator revocation cannot update snapshots; conservative failed-operation settlement records no new authority. F1 does not implement a general queue worker or claim exactly-once physical effects. F2 must add mutable-command leases/receipts/approval/stop integration.

Viewer/Operator require explicit new environment grants for reads. Children are denied management even with extra admin roles; child-safe play/account remains separate. All existing Origin/CSRF/session/revocation rules apply. Remote management routes fail closed with 503 whenever public URL is not loopback: private HTTPS/MFA entry is **not qualified**. Do not expose loopback through a public proxy and treat it as approved remote entry.

## Verification and references

`pnpm check` covers contracts, endpoint policy, fixed status packets, malformed/timeout/oversized responses, protected file/tenant filtering and existing unit checks. `pnpm test:db` uses a dedicated disposable management database and tests prior-tenant upgrade, RLS/FKs/immutable state, concurrent replay, HTTP/CSRF/OpenAPI, remote denial, revocation during I/O, observation fences and metadata-only unregister/reactivation. Browser qualification is CL-F1-03. No real game/Contabo test is implied by socket fixtures.

Primary protocol references reviewed: [PrismarineJS status client](https://github.com/PrismarineJS/node-minecraft-protocol/blob/master/src/ping.js), [Java 1.21.4 packet schema](https://github.com/PrismarineJS/minecraft-data/blob/master/data/pc/1.21.4/protocol.json). This implementation has no new protocol-library dependency and does not claim compatibility with every game/proxy version. Protocol selection is explicit, not inferred from a guessed latest version. [ADR 0017](../architecture/decisions/0017-minecraft-observation-boundary.md) records identity/data-plane boundaries; [preservation runbook](../operations/minecraft-preservation.md) governs live approval.

## Parent observation dashboard

Build current code, sign in through `/account`, create/assign a project and Minecraft environment, then open `/servers`. The adult organization/world selectors reuse current membership. Adoption selects only an operator-approved target: preview the exact name/binding, then register existing. It changes CraftLayer metadata only. A missing/invalid source does not grant a discovery or host-path capability.

Server details show capture provenance/time, freshness, online/offline/unavailable state, approved game addresses, observed names where supported, scoped activity and explicit access/network/recovery gaps. Captured allowlist is labeled configured only when both enabled and enforced flags are true. Public RCON reported by the source gets an adult-attention warning; captured private still requires effective-network proof. No game/backup/access/lifecycle commands exist in this preview. Observe reads the approved source; Refresh overview reads stored metadata. A failed observation preserves the prior snapshot. Registration settings requires typing the exact name before metadata-only removal; durable history is retained.

Viewer/Operator need explicit scoped `environment:read`, `server:read` and optional `player:read`/`operation:read` grants. They get no adoption/observation controls unless their actual role/permissions permit them; the API remains authoritative. Children see the adult-managed explanation and no administration. Organization/world changes clear old detail/player/activity data immediately and ignore late responses. Visible-tab polling refreshes stored metadata every 30 seconds; no implicit network Observe operation runs. Expired sessions clear the view and link back to sign-in.

`pnpm test:server-ui` creates a separate random loopback port, generated credentials, database/Redis volumes, synthetic 0600 inventory and production API/web/worker images. It inspects inventory mount/credential separation without logging environment values, drives adult/viewer/child browser flows, stale/offline/fresh/failure states, tenant switching, typed unregister and logout, checks 390px layout/focus, then removes only its own Compose project/volumes/images/temp files. It never opens the existing installation or Contabo. Optional `CRAFTLAYER_BROWSER_REVIEW=1 pnpm test:server-ui` adds an installed `agent-browser` snapshot/screenshot using a temporary synthetic session state which is removed in `finally`. Screenshots/reports live in ignored `test-results/servers` and `playwright-report/servers`. They are local synthetic evidence, not production artifacts.
