# API, event stream, CLI and extension contracts

Status: design contract. These routes are planned, not available. Zod schemas are canonical for runtime validation; generate OpenAPI and SDK from a single schema source. Do not maintain handwritten divergent clients.

## HTTP conventions

Prefix `/api/v1`. JSON request/response content type; UUID IDs; UTC ISO timestamps; explicit schema versions on persisted/exported objects. Reject unknown action/tool fields. Cursor pagination defaults to 50, maximum 100. Validate body/file size and bound filter complexity. No secrets in URLs or errors.

Context uses authenticated identity plus a selected organization header (proposed `X-CraftLayer-Organization`); validate membership before using it. Resource URLs stay simple while all repository calls require the validated context. Request-body organization fields are absent or must match canonical scope; they cannot select authority. CLI follows the same contract.

Error envelope:

```json
{
  "error": {
    "code": "MISSION_POLICY_DENIED",
    "message": "This preset is not approved for this world.",
    "request_id": "opaque-request-id",
    "details": {"reason": "preset_not_approved"}
  }
}
```

400 invalid input; 401 missing/expired auth; 403 permission denied for known accessible scope; 404 inaccessible/missing resource; 409 version/state/idempotency conflict; 422 invalid graph/policy configuration; 429 rate/quota limit; 503 dependency unavailable. Avoid leaking foreign resource existence through validation errors.

Require `Idempotency-Key` on execute/create operations with external consequences; store request digest and response reference by org/principal/route. Same key and payload replay response; different payload returns 409. Use version/`If-Match` for mutable resources and policy transitions. Idempotent API submission does not guarantee external exactly-once effects.

## Route plan

| Routes | Behavior / permission | Chapter |
| --- | --- | --- |
| `GET /health/live`, `GET /health/ready` | Process vs dependency readiness, no secret details | 00 |
| `POST /auth/bootstrap` | Local single-use setup token, not open public registration | 01 |
| `POST /auth/login`, `/auth/logout`; `GET /auth/me` | Secure session lifecycle | 01 |
| `POST /auth/password-reset/request`, `/consume` | Optional mail or owner-mediated offline reset | 01 |
| `GET /auth/sessions`; `DELETE /auth/sessions/:id` | Own sessions; org/admin operations separately scoped | 01 |
| `POST /auth/cli/exchange`; `DELETE /auth/cli/:id` | Scoped CLI token issuance/revocation; no password argv | 03 |
| `/users`, `/organizations`, `/memberships`, `/roles` | Scoped identity administration; instance org creation is explicit | 01 |
| `/invitations`, `/invitations/:id/consume` | Expiring single-use invite with approved role | 01 |
| `/projects`, `/environments` | Project/env config and policy; `environment:admin` | 01, 04 |
| `/providers`, `/providers/:id/models`, `/providers/:id/test` | Redacted config/catalog and bounded admin test | 02 |
| `/budgets`, `/usage` | Scoped limits/reports; changes audited | 02 |
| `/agents`, `/groups`, `/groups/:id/agents` | Fleet lifecycle and assignment | 03 |
| `/mission-templates`, `/presets`, `/presets/:id/approve` | Versioned templates and adult approval | 03, 05 |
| `POST /missions`; `POST /missions/:id/execute` | Draft then validated DAG snapshot/queue | 03 |
| `GET /missions`, `/missions/:id`, `/missions/:id/tasks` | Authorized progress and outcomes | 03 |
| `POST /missions/:id/pause`, `/resume`, `/cancel` | Versioned state transition, idempotent command | 03 |
| `POST /emergency-stop`; `GET /stop-operations/:id` | Scoped latch and acknowledgement visibility | 03 |
| `POST /emergency-stop/:id/clear` | Separate adult/privileged clear; no implicit resume | 03 |
| `GET /events`; `GET /events/stream` | Cursor replay plus WebSocket upgrade/SSE projection | 03, 05 |
| `/approvals`; `POST /approvals/:id/decision` | Exact-action independent adult approval | 08 |
| `GET /artifacts/:id`, `/research-sources/:id` | Scoped safe download, no filesystem path exposure | 08 |
| `GET /audit` | Redacted admin audit cursor | 01 onward |

Use explicit allowed methods per resource in the implementation OpenAPI, rather than automatically exposing generic CRUD. Do not expose role deletion or credential GET operations merely because a table exists.

## Event protocol

```json
{
  "schema_version": 1,
  "event_id": "opaque-uuid",
  "cursor": "opaque-scoped-cursor",
  "type": "task.state_changed",
  "organization_id": "opaque-uuid",
  "project_id": "opaque-uuid",
  "mission_id": "opaque-uuid",
  "occurred_at": "2026-10-31T12:00:00Z",
  "correlation_id": "opaque-uuid",
  "aggregate_version": 4,
  "payload": {"task_id": "opaque-uuid", "from": "running", "to": "succeeded"}
}
```

Event families: identity/policy changed, fleet connected/disconnected, mission/task state, approval requested/decided, provider cooldown, budget threshold, stop requested/acknowledged/quiesced and artifact ready. Typed payloads contain public projections, not raw model messages or keys.

Subscriptions authenticate on connect, validate Origin and selected org, and revalidate on membership/policy changes. Close/restrict sessions on revocation. Never accept arbitrary org/mission channel names. Apply connection/message limits, heartbeat, bounded send buffers and replay page size.

Delivery is at least once; client deduplicates by event ID and ignores older aggregate versions. A scoped opaque cursor resumes replay; authorization is checked again for every replayed projection. If retention invalidates a cursor, send `resync_required` and obtain a fresh REST snapshot. Drop slow clients cleanly rather than consuming unbounded memory. Redact child streams independently of adult logs.

## CLI surface

Planned commands: `craftlayer login`, `org select`, `status`, `provider list`, `agent list`, `group list`, `mission create`, `mission execute`, `mission watch`, `mission pause|resume|cancel`, `stop`, `config validate`, plus separately privileged local `owner reset-password`, `backup`, `restore`, `upgrade-check`.

Support `--json`, stable exit codes, noninteractive operation, explicit org/env selection and clear destructive-action confirmation where appropriate. Never take raw passwords/provider keys as argv flags. CLI does not bypass API permissions. Local owner recovery tools require host-level access and are not HTTP backdoors.

## Adapter contracts

Retain the blueprint's `startAgent`, `observe`, `execute`, `stopAgent`, `listModels`, and `generate` concepts. Add an explicit execution context with cancellation, action deadline, lease/fence, capability set, organization/environment identity and typed tool inputs. `stopAgent` is idempotent; `execute` returns verified/uncertain/failed outcome, receipts, resource usage and bounded observations.

Adapters advertise contract version, supported task/tool schemas, idempotency class, reconciliation capability and host requirements. Contract tests cover invalid configs, timeout, stop, reconnect, effect uncertainty and redaction. No arbitrary dynamic plugin installation in the first release; adapters are reviewed and built into versioned images.
