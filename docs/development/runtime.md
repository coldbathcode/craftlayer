# Simulation runtime and fleet operations

Chapter 03 is in progress. CL-03-01–04 supply bounded domain persistence, authenticated fleet/template/mission commands, durable fair dispatch and API-controlled simulation workers with bounded model decisions and independent approvals. Persistent stop controls, scoped streams and conservative recovery are implemented through CL-03-06; final fault review follows in CL-03-07. No Minecraft connection, coding runner, external tool or live inference is implied. [ADR 0014](../architecture/decisions/0014-runtime-authority-and-recovery.md) defines the trust boundary.

Use a dedicated `simulation` environment created through the authenticated environment API with `{projectId,name,type:"simulation"}`. The existing account console can create projects; simulation setup is currently an API/CLI workflow, not the Minecraft world UI. Adults need explicit environment-scoped permissions or organization administration. Child access remains limited to assigned Minecraft worlds and cannot enter simulation.

## Command and authority model

The API derives membership from the current session and loads canonical resource scope. Every runtime list requires an explicit `environment_id`; an organization header alone is insufficient. Templates and groups are environment scoped and immutable after creation. Revising a template creates another immutable ID/version in its family. A mission snapshots its graph and hash; a later template version cannot alter an existing mission.

The JSON graph has schema version 1, 1–50 uniquely named task nodes, explicit dependency keys and required/optional outcomes. Cycles, duplicate/missing edges, unknown kinds/fields, more than three attempts or actions over ten seconds reject. Only reviewed `fixture.echo`, `fixture.wait`, `fixture.fail`, `fixture.model` and `fixture.approval` definitions are accepted. Their later execution must still pass worker authority/budget/stop/receipt checks. A model cannot supply an arbitrary tool, credential or endpoint.

Current routes under `/api/v1`:

| Route | Behavior |
| --- | --- |
| `GET, POST /agents` | Scoped list/create simulation agents; assignment requires `agent:assign` |
| `PUT /agents/:id/status` | Versioned enable/disable; refuses active or uncertain assignments |
| `GET, POST /groups` | Same-environment group of 1–4 distinct agents; creation needs `group:manage` |
| `GET, POST /mission-templates` | Scoped immutable graph versions; writing needs `template:write` |
| `GET, POST /missions` | Bounded scoped list or create a snapshotted draft; creation needs `mission:create` |
| `GET /missions/:id` | Scoped redacted state/task projection; `mission:read` |
| `POST /missions/:id/execute` | Current `mission:execute`, expected version and UUID idempotency key; stores a signed current-user execution grant |

All cookie mutations require exact Origin and session CSRF. Creation/execution of missions also require a UUID `Idempotency-Key`. Same actor/route/key/body replays the original response; changing the body conflicts. A replayed response is an original snapshot, so GET the mission for latest state. Idempotency never overrides current permission. Terminal missions cannot restart in place. Signed grants/cookies/provider keys never enter mission projections or queue messages.

## CLI

Use the trusted loopback/HTTPS origin and supply passwords through hidden input or stdin, never argv:

```bash
pnpm cli login http://127.0.0.1:3000 your-login
pnpm cli fleet agents ORGANIZATION_UUID ENVIRONMENT_UUID
pnpm cli template list ORGANIZATION_UUID ENVIRONMENT_UUID
pnpm cli mission list ORGANIZATION_UUID ENVIRONMENT_UUID
pnpm cli mission get ORGANIZATION_UUID MISSION_UUID
pnpm cli logout
```

The CLI calls the same API with the same contracts/permissions. It stores an opaque session cookie and CSRF token in mode-0600 `~/.config/craftlayer/session.json`, under a mode-0700 directory. The file must belong to the current non-root operator; symlinked, oversized or unsafe files deny. OS keychain integration/Windows qualification remains later release work. `CRAFTLAYER_CLI_SESSION_FILE` overrides the path for disposable tests. Never commit or print session contents.

Create resources using protected JSON input files you control:

```bash
pnpm cli fleet create-agent ORGANIZATION_UUID agent.json
pnpm cli fleet create-group ORGANIZATION_UUID group.json
pnpm cli template create ORGANIZATION_UUID template.json
pnpm cli mission create ORGANIZATION_UUID mission.json IDEMPOTENCY_UUID
pnpm cli mission execute ORGANIZATION_UUID MISSION_UUID EXPECTED_VERSION IDEMPOTENCY_UUID
```

`agent.json` contains `environment_id`, `name` and `adapter:"simulation"`. `group.json` contains `environment_id`, `name`, `agent_ids`. `mission.json` contains `group_id`, `template_id`, `name`. Template input:

```json
{
  "environment_id": "REPLACE_WITH_SIMULATION_UUID",
  "name": "Observe and verify",
  "adapter": "simulation",
  "graph": {
    "schema_version": 1,
    "nodes": [
      {"key":"observe","action":{"kind":"fixture.echo","value":"observed"}},
      {"key":"verify","dependencies":[{"key":"observe"}],"action":{"kind":"fixture.echo","value":"verified"}}
    ]
  }
}
```

Replace the illustrative environment string with a real UUID. Defaults are required nodes/edges, three attempts and five-second action deadlines. Add `supersedes` with an existing same-environment template ID to create a new family version. The API rejects an invalid graph before persistence.

A successful CLI login prints only authentication status. Other commands emit authorized JSON resource projections or sanitized errors with nonzero exit codes. Logout revokes the session and therefore any queued grant tied to it; worker execution must revalidate, not trust the original submit response. Child/viewer denials are enforced by the API regardless of CLI arguments.

## Durable dispatch and runtime quotas

BullMQ 6.5.3 uses the existing private Redis backend; PostgreSQL remains authoritative. Queue messages carry schema version, event UUID, org lookup hint, task UUID and execution generation only. No grant, prompt, provider token or worker bearer is queued. Each API process can take bounded fair tenant turns through a transaction-scoped leadership lock and monotonic turn index; inactive tenants leave the scan. Outbox rows lease publication for 15 seconds and acknowledge by lease ID outside Redis I/O. A crash after publication repeats the same event ID. A still-ready task with missing delivery can publish a new hint after five seconds; actual worker claims must still fence canonical state. Dispatch repair is bounded to 128 references/task. Redis operations have two-second connect/command bounds, with durable retry timing rather than an open SQL transaction.

`GET, PUT /api/v1/runtime-budgets/:kind/:id` administer org/user/project quotas with `budget:manage`, canonical scope and expected versions. Default per-scope limits: two active missions, four active agents, 500 tool calls/hour, 600,000 execution milliseconds/hour and 64 MiB allocated storage. Immutable instance ceilings: four active missions, eight active agents, 10,000 tool calls/hour, 3,600,000 execution milliseconds/hour and 256 MiB allocation. All required scopes must fit atomically. Paused/blocked missions and uncertain attempts retain concurrency until known terminal settlement; hour rollover does not free them.

Accounting explicitly reports `reserved_estimates`: a task attempt charges its bounded runtime and ten potential tool calls conservatively, rather than trusting a worker's CPU report. Storage allocates 4 KiB/agent, 8 KiB/group, 1 MiB/template and 1 MiB/task plus 256 KiB/mission for bounded records. These are conservative application allocations, not disk/CPU measurements or a substitute for container/host limits. Allocations are not silently refunded by deletion; retention/recovery tooling remains Chapter 09. Provider token/money limits remain independently authoritative. An exhausted cap blocks new work rather than increasing limits automatically.

## Registered simulation worker process

The runtime includes a real API-controlled worker and CLI enrollment. Base Compose leaves its consumer unconfigured, health-checking private API/Redis without a database credential. A configured worker can process at most two simulation actions concurrently; canonical active-agent/membership/budget checks remain at the API. Task projections now include the latest canonical agent UUID. Model prompts remain at the trusted API; the worker receives only a registered action/proposal and short-lived authority.

After logging in as an adult with the required environment assignment, enroll a worker and prepare transport settings:

```bash
pnpm cli worker enroll ORGANIZATION_UUID ENVIRONMENT_UUID
pnpm setup:worker
docker compose --env-file .env --env-file .worker-secrets/compose.env \
  -f docker-compose.yml -f infra/compose/worker.yml up -d --build --wait
```

Enrollment writes ignored mode-0600 `.worker-secrets/credential.json` under a mode-0700 directory; it refuses to overwrite an existing credential. The CLI prints metadata/path only. The directory is mounted read-only only into the worker, whose UID/GID match its owning host operator. It never contains provider master keys or identity database settings. Worker registrations expire after 24 hours; `worker list <org> <environment>` is redacted and `worker revoke <org> <worker> <version>` revokes immediately at subsequent authorization checks. Lost enrollment responses cannot recover a plaintext token: inspect/revoke the orphaned registration and enroll again deliberately. File/token rotation requires quiescing and restarting the worker; it does not silently resume paused work.

Host development uses `pnpm dev:worker` and protected `.worker-secrets/host.env`, with the developer data-port override described in quickstart. Do not load the API's root `.env` into a worker process. Its config parser rejects database, recovery, CSRF, SMTP and provider-file authority. Docker uses only its selected transport environment. Core Redis is trusted private infrastructure; reference-only queue data does not turn it into a hostile multi-tenant broker.

The watchdog uses monotonic request-start times, subtracts network delay, clamps renewals to the initial action deadline and never resurrects an expired controller. One-second heartbeat failure aborts the action. A hung heartbeat cannot extend action authority; simulated effects stop before the original ten-second-or-smaller deadline. RPCs have explicit deadlines and 16 KiB response bounds. These simulation guarantees are not physical game/sandbox shutdown certification.

`pnpm test:runtime-stack` creates a disposable private installation, enrolls a protected real worker, executes a parallel two-agent DAG through CLI/API, checks verified results and env/mount/log separation, then removes its containers/images/volumes. It performs zero catalog/model/game calls. `pnpm test:offline` proves the pure/watchdog suite without external networking.

## Bounded model decisions and independent approvals

Worker RPC `/api/v1/worker/decide` uses the same registered bearer/protocol/fence/current initiating authority as claims, permits and results. `fixture.model` can propose only strict JSON `{"tool":"fixture.echo","arguments":{"value":"..."}}` (value at most 512 characters). Unknown tools, extra authority fields, tool-call responses, oversized output and invalid JSON reject. At most three inference calls (initial plus two repairs) are allowed per attempt. Repairs contain a fixed schema reminder, never the untrusted previous response. Only the validated proposal is persisted; normal events contain neither prompt nor response.

Each call gets a persisted server request UUID before provider work. Provider Gateway eligibility/free-only/accounting still applies. Immediately before its durable dispatch mark, a narrow SQL storage interface rechecks the exact canonical model call, worker, mission generation/fence/state, lease/action deadline and signed initiating grant. It shares the provider ledger transaction and runtime lock ordering; no transaction spans provider HTTP. Duplicate decisions in flight reject, completed decisions cache, and a lost response after dispatch blocks as uncertain without automatic inference replay or refund. Local tests use fake providers only; a real operator-local inference connection still requires deliberate operator configuration and authorization to run.

`fixture.approval` blocks before any receipt/effect and exposes its exact action through `GET /api/v1/approvals?environment_id=UUID`. `POST /api/v1/approvals/:id/decision` accepts only `{decision:"approve"|"reject"}` from an independently authorized adult. The creator cannot approve themself. Hashes bind immutable action/mission/environment/template, execution generation and runtime policy versions; changed policy, stale generation or expired approval cannot authorize an action. Approval expires within five minutes/the mission deadline. The scheduler revalidates both initiating and approving grants before waking work. Preparation revalidates the exact same approval and both current authorities, with the permit deadline clamped to their session/grant/approval expiries. Approval tasks are serialized as barriers against concurrent mission actions. Rejection fails the blocked mission and releases only known inactive capacity.

```bash
pnpm cli approval list ORGANIZATION_UUID ENVIRONMENT_UUID
pnpm cli approval approve ORGANIZATION_UUID APPROVAL_UUID
pnpm cli approval reject ORGANIZATION_UUID APPROVAL_UUID
```

Use a separate adult CLI session/file for the reviewer. Approved work retains its original finite attempt ceiling; approval never increases budgets or creates permissions. This simulation primitive does not authorize future coding, deployment or Minecraft tools.

## Pause, cancel and emergency stop

`mission pause|cancel|resume <org> <mission> <expected-version> <idempotency-uuid>` uses the same scoped REST permissions as the dashboard will use. Pause preserves verified tasks and capacity, advances execution generation and requests active attempts stop. Cancel reports `cancelling` until known quiescence; a prepared/unknown effect stays `blocked/uncertain` with its active hold. Resume requires both current pause and execute authority, a fresh signed execution grant, cleared applicable latches and no active/uncertain attempt. It preserves the original mission deadline and finite attempt counts. It cannot resurrect terminal/cancel-requested missions.

`POST /api/v1/emergency-stop` accepts `{kind,scope_id,reason}`. Kinds are `organization`, `environment`, `mission` and owner-only `instance`; the instance scope UUID is `00000000-0000-4000-8000-000000000001`. Scope comes from authenticated permission/canonical resources, never a body org override. Children cannot control simulation. Latches and monotonic epochs persist in PostgreSQL; each stop records targeted attempts and pauses applicable missions. Claims, permits and the actual model dispatch mark reject applicable latches after commit. A concurrently published queue hint cannot authorize effects.

`GET /api/v1/stop-operations/:id` exposes scoped requested/acknowledged/quiesced/unreachable counts. Known retirement can prove quiescence independently of worker acknowledgement. An expired deadline without acknowledgement or known quiescence is unreachable, never silently considered stopped. Unknown effect state is conservative even after a worker acknowledges that its process stopped. `POST /api/v1/emergency-stop/:id/clear` requires `{expected_epoch,reason}` and the distinct clear permission (instance owner for instance scope). Old operation/epoch cannot clear a newer latch. Clearing leaves missions paused; resume is explicit.

```bash
pnpm cli stop request ORGANIZATION_UUID stop.json
pnpm cli stop get ORGANIZATION_UUID OPERATION_UUID
pnpm cli stop clear ORGANIZATION_UUID OPERATION_UUID EPOCH 'Reviewed local state'
pnpm cli mission resume ORGANIZATION_UUID MISSION_UUID VERSION IDEMPOTENCY_UUID
# Protected host recovery capability; needs PostgreSQL but no API, UI or Redis:
pnpm cli owner emergency-stop
```

The local owner command uses the ignored host configuration/recovery capability, does not expose a recovery HTTP endpoint, and cannot clear or resume work. Keep that configuration protected as described in the identity runbook. It never prints database credentials or recovery tokens. Connected worker authorization loss aborts at the one-second heartbeat; a hung heartbeat cannot extend the original action deadline (at most ten seconds). Fake-clock proofs measure last simulation effects at/before one second for connected denial and before six seconds under a hung-heartbeat six-second action. Actual game/sandbox process disconnect guarantees remain adapter work, not simulation certification.

Stop/audit history is retained. The current conservative mission storage allocation does not measure actual disk use; production retention and disk exhaustion supervision remain Chapter 09. Safety stop is not disabled because a normal mission budget is exhausted.

## Expired attempts and conservative recovery

Scheduler maintenance scans canonical expired/revoked attempts even when their mission is paused or blocked. An attempt with no receipt and no dispatched model call has no authorized external effect: it retires and can enter bounded retry while its mission remains executable. The scheduler revalidates current authority before producing another ready hint. Prepared effects or dispatched/unknown inference become uncertain and keep capacity; Redis replay never clears them. A fresh worker must claim the new fence.

`GET /api/v1/missions/:id/recovery` (CLI `mission recovery <org> <mission>`) exposes bounded uncertain attempt evidence without prompts/keys. Reconcile only after checking external state and stopping/revoking the worker. `POST /api/v1/missions/:id/recovery/:attempt` / `mission reconcile <org> <mission> <attempt> <json-file>` requires the exact current `evidence_hash`, `quiescent:true` and a bounded review `reason`. The worker registration must be revoked and both lease/action deadline expired. Any unsettled provider reservation must first be conservatively reconciled through the provider runbook; no money/token hold is silently refunded.

Runtime reconciliation records an adult attestation and fails the unverifiable task; it cannot manufacture a verified result or repeat an uncertain effect. It releases known retired attempt capacity and only ends/releases the mission when no active/uncertain attempts remain. Cancellation intent survives this path. Changed worker acknowledgement/revocation/evidence requires a fresh hash. Immutable audit/effect history is retained. New work is a deliberate fresh mission with a new worker registration, never a hidden success/retry.

## Authorized replay and SSE

`GET /api/v1/events?environment_id=UUID[&mission_id=UUID][&cursor=OPAQUE]` uses authenticated membership and environment read authority. A fresh request returns up to 20 mission summaries plus a current cursor; `snapshot_truncated` signals that individual REST resources may also be needed. Summaries omit task details/results; fetch the authorized mission for full state. A valid cursor returns at most 50 ordered public events and `has_more`. Event UUIDs support deduplication; internal global ordinals are encrypted and never exposed. Cursors bind user/session/membership versions, org/environment and optional mission filter. Foreign/tampered cursors deny. Positions expire after 15 minutes or resync if their retained anchor is unavailable, returning a fresh scoped snapshot. Current history is retained; production pruning remains Chapter 09.

`GET /api/v1/events/stream` accepts the same query and authenticated org header, with either query cursor or `Last-Event-ID`. Conflicting cursors reject. It uses SSE through the private API/web proxy, not a second WebSocket server. `snapshot`, typed runtime events and `cursor` frames are strict public projections. Normal events contain IDs/state/reasons/versions only, never prompts, credentials, grants, raw model responses or chain-of-thought. Current authorization is rechecked every 500 ms before synchronous bounded enqueue; identity locks never wait for socket drain. Logout, disable, expired grant/session or changed membership ends delivery. A stream alone does not extend idle session lifetime. Refresh/reconnect follows current authentication.

Limits per API process: two streams per user/org, eight per org, 32 total. No poll overlaps itself. Outbound buffering is capped at 64 KiB and socket backpressure disconnects the consumer; reconnect from the last received cursor and deduplicate UUIDs. Origin/cross-site requests reject, and no credentials travel in URLs. Multi-instance admission/global stream supervision and production proxy/load qualification remain release work. Stopping an API closes its streams; PostgreSQL replay supplies continuity.

```bash
pnpm cli events list ORGANIZATION_UUID ENVIRONMENT_UUID [OPAQUE_CURSOR]
pnpm cli events watch ORGANIZATION_UUID ENVIRONMENT_UUID [OPAQUE_CURSOR]
```

Watch reconnects with its last validated cursor and stops on current authorization denial. Ctrl-C/SIGTERM cancels cleanly; slow stdout is bounded. The browser-safe SDK exports the same strict incremental parser with frame limits, event ID/type binding and bounded duplicate tracking. `pnpm test:db` exercises actual HTTP streaming and CLI watch plus controlled backpressure; pure tests cover encrypted cursor scope/expiry and fragmented/oversized/malicious frames. See [Fastify 5 reply lifecycle](https://fastify.dev/docs/latest/Reference/Reply/) and the [SSE protocol](https://html.spec.whatwg.org/multipage/server-sent-events.html).
