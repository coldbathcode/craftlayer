# Providers, credentials and budgets

Chapter 02 implements the internal provider gateway and adult administration API. The account console does not yet expose provider forms; dashboard work is Chapter 05. There is no public prompt-generation endpoint. The fleet engine in Chapter 03 must connect canonical missions, tasks, leases and the wider emergency-stop system before agent execution.

The normal local stack needs no provider account, model download, key or network entitlement. Its provider configuration is disabled. All chapter acceptance uses synthetic responses. No hosted inference, real Ollama inference, provider bill or small-host capacity is qualified by this evidence. See the [chapter review](../reviews/02-provider-gateway.md) and [ADR 0013](../architecture/decisions/0013-provider-gateway-boundary.md).

## Optional protected configuration

Run as the non-root host operator who will own the files:

```bash
pnpm setup:local
pnpm setup:providers
```

The second command creates ignored `.secrets/` with mode 0700 and three mode-0600 files. Existing values are preserved. Never add this directory to Git, Docker build context, artifacts or application logs.

| File | Purpose |
| --- | --- |
| `provider-keys.json` | Active encryption key ID and a map of up to 16 versioned 32-byte hex keys; no provider API token belongs here |
| `provider-policy.json` | Operator-owned endpoint/model, instance budget and stop constraints |
| `provider.env` | Host UID/GID used by the optional API container; no key values |

The generated policy disables OpenRouter and local endpoints, permits zero paid micro-USD and leaves stop clear. The key file encrypts API-submitted provider credentials; it is not itself a provider credential. Missing, malformed, symlinked, oversized, wrong-owner or group/world-readable key/policy files fail closed. Files must be regular files owned by the API process UID and no larger than 64 KiB. The API checks files as it uses them.

Enable the optional mounts/network explicitly:

```bash
docker compose --env-file .env --env-file .secrets/provider.env \
  -f docker-compose.yml -f infra/compose/providers.yml config --quiet
docker compose --env-file .env --env-file .secrets/provider.env \
  -f docker-compose.yml -f infra/compose/providers.yml up -d --build --wait
```

Use the same Compose arguments for subsequent management of this configuration. The API runs as the owning non-root host UID/GID and receives a read-only directory mount at `/run/secrets/providers`. A directory mount makes atomic file replacement visible to the running API. Worker and web receive neither these files nor provider configuration. The override explicitly adds API provider egress; default Compose does not. Docker daemon/host operators remain trusted. Do not mount the Docker socket.

To disable providers, set both endpoint lists empty and OpenRouter disabled, persist instance stop, then recreate the API using base Compose alone. This removes its optional key mount and egress. Configuration changes do not erase encrypted database rows or clear the separate organization stop latch.

## Operator policy

This is a disabled example, matching the generated defaults (the `limits` field is optional and receives the defaults shown):

```json
{
  "version": 1,
  "openrouter_enabled": false,
  "openrouter_models": [],
  "allow_paid": false,
  "max_paid_micro_usd": "0",
  "stopped": false,
  "ollama": [],
  "limits": {
    "calls": 100,
    "input_tokens": 1638400,
    "output_tokens": 204800,
    "total_tokens": 1843200,
    "micro_usd": "0",
    "concurrent": 4
  }
}
```

Edit through a protected temporary file in the same directory, validate JSON/schema and mode/owner, then rename atomically. Never overwrite an existing key ID with new key bytes. Keep an offline protected backup separately from the database. Docker Desktop host/VM bind-file updates can propagate asynchronously. Keep the persisted organization stop latched through edits and confirm successful rewrap/configuration checks before resuming; an operator file rename alone is not an instantaneous distributed stop. Transient missing-file reads fail closed. The file content hash participates in dispatch revalidation, so even a change without incrementing `version` invalidates old decisions. Increment the version for operator traceability anyway. Invalid configuration blocks operations rather than falling back to permissive defaults.

For Ollama, add an exact operator-controlled endpoint, concrete address pins and installed model IDs under `ollama`. The schema accepts entries shaped like this **illustrative, unqualified deployment**, not a model recommendation:

```json
{
  "id": "home_ollama",
  "url": "http://192.168.1.50:11434/",
  "addresses": ["192.168.1.50"],
  "models": ["operator-installed-model:tag"],
  "cloud_disabled": true,
  "context_tokens": 4096,
  "output_tokens": 1024
}
```

Replace every illustrative value with your actual deployment. The model must already be installed; CraftLayer never pulls it. Containers cannot reach a host model server using the container's `127.0.0.1`. DNS must resolve only to the approved private/loopback addresses, and the actual socket is pinned to a validated address. Root HTTP(S) URLs only; no embedded credentials, query strings, redirect following or arbitrary API paths. Private plain HTTP trusts that network; use a correctly verified HTTPS endpoint where appropriate.

Disable Ollama cloud features on the server using its documented configuration, and verify the deployment before attesting `cloud_disabled: true`. That field is an operator assertion, not remote attestation. Discovery rejects cloud/proxy metadata and requires installed GGUF completion/context evidence. Unknown capabilities remain unknown. Thinking models are eligible only when disabled thinking is explicitly supported. Provider invoice estimates can be zero while CPU, RAM and electricity still have costs. [Ollama configuration](https://docs.ollama.com/faq).

OpenRouter is limited to the fixed HTTPS API host and explicit canonical model IDs in `openrouter_models`. Dynamic routers, provider-selected fallback arrays and optional paid features are excluded. A `:free` suffix proves nothing about the complete invoice. Current documented pricing/routing controls do not establish every ancillary dimension or complete zero-cost enforcement, so the real OpenRouter adapter remains ineligible under strict free-only and zero-spend policies. Setting `allow_paid` does not manufacture missing price evidence. The chapter includes its bounded protocol/negative contracts, not a claim of usable free hosted capacity. No model list or price is hardcoded. [Provider routing controls](https://openrouter.ai/docs/guides/routing/provider-selection).

## Adult administration API

Authenticate through local identity, select an organization from current membership, and send its ID in `x-craftlayer-organization`. Organization headers select context; membership and scoped permission checks remain authoritative. Mutations require the configured same origin, session cookie and `x-csrf-token`. Use a trusted HTTP client that keeps secret inputs and cookies out of shell history, process arguments and logs. Browser submissions must use the trusted private loopback deployment or protected HTTPS when deployed remotely.

The generated `/api/v1/openapi.json` is the exact running contract. Unknown request fields are rejected. Connection creation accepts a label, `kind`, operator-defined `endpoint_id` and an OpenRouter `secret`; it accepts no arbitrary URL. `openrouter` is the only hosted endpoint ID. Ollama receives no credential. Responses expose configuration status/key ID only. Versioned edits return 409 on stale versions; refetch before retrying. Do not blindly retry credential mutations.

| Route under `/api/v1` | Behavior / authority |
| --- | --- |
| `GET, POST /providers` | List/create redacted connections; `provider:manage` |
| `PUT /providers/:id/status` | Enable/disable with `expected_version`; disabled snapshots are invalidated |
| `PUT, DELETE /providers/:id/credential` | Replace/revoke token with version; revoke also disables connection |
| `POST /providers/:id/rewrap` | Re-encrypt existing token under active master key, version checked |
| `GET /providers/:id/models` | Read normalized catalog snapshots |
| `POST /providers/:id/refresh` | Explicit bounded catalog discovery; this is network I/O, throttled to five seconds per connection |
| `GET, PUT /model-policy/:kind/:id` | Organization/user/project policies, version checked; `budget:manage` |
| `GET /providers/stop` | Read persistent org/instance provider stop |
| `POST /providers/stop` | Request stop with `stop:request` |
| `POST /providers/stop/clear` | Separately clear organization stop with `stop:clear`; cannot clear instance file stop |
| `GET, PUT /budgets/:kind/:id` | Versioned org/user/project hourly limits; `budget:manage` |
| `GET /usage` | Latest 100 reservations and 100 ledger entries for this organization; `budget:manage` |
| `POST /usage/:id/reconcile` | Adult budget administrator records conservative recovery after confirmed quiescence |

No public generation route exists. `ProviderGateway.generate` is an internal server API requiring a current signed adult mission-execution grant tied to a canonical project/environment. Children cannot use it. Future child preset execution needs a separate adult-approved runtime path, not relaxed raw inference permissions. Mission/task UUID labels currently group budgets only; Chapter 03 must load and validate canonical entities and their policies. Queue messages must never carry keys or become authority by themselves.

## Key rotation and revocation

1. Pause new dispatch with organization stop, and consider the instance file stop for a whole installation. Establish what requests are still running; stopping new dispatch does not undo a dispatched provider call.
2. Back up the current database and key file through protected operator procedures. Cross-system restore is not yet qualified; Chapter 09 must supply a coordinated drill.
3. Create a new independent random 32-byte key under a **new** key ID, retain all old keys and set `active` to the new ID. Write mode 0600 under the API UID and rename atomically. Never paste key bytes into docs, commands, tickets or console output.
4. List all applicable connections as each authorized organization administrator. Call `rewrap` with the current connection version. Repeat for every encrypted credential. Rewrapping increments its version and invalidates catalogs; refresh when appropriate before new work.
5. Verify redacted connection metadata now references the new ID. The 100-connection per-org list is bounded: a multi-org operator must verify every organization's rows, not infer installation-wide completion from one API response. If an organization may have more than 100 rows, keep old keys until a complete tenant-scoped inventory of row counts/key IDs is established by a trusted operator; this chapter supplies no complete inventory/cursor endpoint. Inventory never requires decrypting tokens. Only then remove unused old keys atomically. Retain protected recovery copies according to the backup policy.
6. Resume deliberately by clearing the independent organization latch and any instance stop you set. Never auto-clear after restart or a credential edit.

Revoking a provider token uses the credential DELETE route and separately the provider's own account controls when needed. Database revocation blocks future dispatch but cannot retract an already sent request. A missing old master key makes its ciphertext unusable; creating a new key with the same ID cannot recover it. Do not delete old keys until all rows and required backups are accounted for.

## Quotas, routing and accounting

Budgets intersect instance → organization → user → project → optional mission → optional task. Every scope defaults to **10 calls/hour, 163,840 input tokens/hour, 20,480 output tokens/hour, 184,320 total tokens/hour, zero micro-USD and two active calls**. The instance defaults are ten times those hourly units and four active calls. Windows use UTC hours. Zero concurrency/calls blocks execution. API counters are decimal strings; monetary math uses integer micro-USD and rounds reservation costs upward, never floating point.

Limits do not allocate extra capacity: all scopes must fit atomically. A new scope cannot bypass an exhausted parent. Tightening policy/limits does not erase prior usage or release active holds. Lowering a cap below current usage prevents further dispatch. Limits are shared across restarts/organizations where applicable; the API does not reveal global instance totals to tenants. Current provider units are calls, input/output/total tokens, money and active calls; runtime/CPU/tools/storage budgets described in the architecture remain later-chapter work.

Only fresh eligible models enter deterministic bounded routing. The default is two attempts and a separately reserved fallback. A 429 creates a persisted bounded cooldown (maximum five minutes); it never authorizes paid fallback. No adapter retries automatically. All candidates blocked yields a bounded internal block result; Chapter 03 must expose that status to missions. Explicit refresh can be required when snapshots expire. No automatic catalog polling daemon is introduced.

The gateway reserves worst-case input/output and applicable ancillary costs, then rechecks authority, connection/key versions, policy, stop, current window and cooldown immediately before marking dispatch. A marked call can be uncertain even when no response arrived. SQL transactions do not span HTTP. Request ID plus input hash blocks replay; it does not cache completed output. A quota-denied claimed request ID needs a fresh attempt ID on retry. Chapter 03 must persist runtime outcomes so a queue redelivery does not become a new unaccounted call.

A successful response with complete observed token usage can reduce token accounting. Missing usage charges the full estimate. Money remains conservatively estimated at least at the reservation ceiling because provider invoice completeness is unproved; observed tokens are not a receipt for every ancillary charge. Reports distinguish qualities. A larger late receipt adds immutable compensating deltas; an overrun latches stop. There is no invoice accuracy or exactly-once physical-effect guarantee.

## Uncertain outcome recovery

Reservations transition `reserved → dispatched → settled/uncertain`; known non-dispatch may become `released`. Dispatched errors retain maximum usage and active holds. Hour rollover, timeout, restart, session revocation and policy edits never auto-refund uncertain costs or concurrency. Settlement remains possible after the initiating user's access is revoked.

An adult with `budget:manage` must investigate the request/provider and establish it is **no longer running** before reconciliation. Preserve protected operator evidence and compute a SHA-256 evidence hash; the API stores the hash, not raw prompts, keys or private investigation artifacts. Submit `receipt_hash` and `confirmed_quiescent: true` to the reconcile route. This is an explicit administrator attestation, not automatic proof.

- A still-`reserved` record with no dispatch mark releases its reservation and fences a late dispatch.
- A `dispatched` or `uncertain` record becomes settled at full estimated usage/cost, then releases active concurrency.
- Terminal records reject another reconciliation. Repeated provider settlement receipts do not double-charge; larger receipts can add positive corrections.

Do not invent usage or directly edit counters to restore capacity. If quiescence cannot be established, preserve the hold and stop affected work. A provider call that continues after a lost connection is an external uncertainty, not a safe retry signal.

## Reproducible qualification

```bash
pnpm check
pnpm test:db
pnpm test:provider-stack
pnpm test:offline
```

`test:provider-stack` creates its own random-port Compose installation and fresh owner, verifies protected mounts, atomic key replacement/rewrap, permission failure, credential revocation, zero-spend budgets, stop across API restart and log/response canaries, then deletes its containers/images/volumes. It makes **zero model or catalog calls**. It never claims the real installation. Unit adapters use fake transports; database concurrency/recovery tests use fake inference. Any future live smoke must record separate authorization, exact provider/model/hardware/configuration and actual results.
