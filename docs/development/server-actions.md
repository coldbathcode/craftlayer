# Server actions (intake)

Status: master plan [A3](../plan/A-live-connection.md) intake built and verified in the disposable database suite on 2026-11-08. **No action reaches a server yet**: there is no node dispatch, so requests stay `pending` (shown as `awaiting_node`) and expire after ten minutes. Design: [ADR 0040](../architecture/decisions/0040-server-action-intake.md).

## Actions and permissions

| Action | Request | Permission |
| --- | --- | --- |
| `allow_player` | `{edition:"java", name}` or `{edition:"bedrock", gamertag, xuid}` | `player:manage` |
| `revoke_player` | `{name}` | `player:manage` |
| `kick_player` | `{name, reason?}` | `player:manage` |
| `say` | `{message}` | `server:control` |
| `save` | `{}` | `server:control` |
| `start`, `stop`, `restart` | `{}` | `server:control` |

Adults only; children and agent tokens are refused. Names match `^\.?[A-Za-z0-9_]{1,16}$`, messages are one line without control or formatting characters and cannot start with `/`.

## API

| Call | Effect |
| --- | --- |
| `POST /api/v1/servers/{id}/actions` + `Idempotency-Key` | Records a pending action (202). 409 `ACTIONS_STILL_OPEN` for a lifecycle action while others are open; 409 `LIFECYCLE_ACTION_PENDING` behind a pending stop/start/restart; 429 `ACTION_QUEUE_FULL` at eight open |
| `GET /api/v1/servers/{id}/actions` | Newest first, with `awaiting_node` and `can_cancel` (`server:read`) |
| `GET /api/v1/server-actions/{id}` | One action |
| `POST /api/v1/server-actions/{id}/cancel` | Cancels a pending action; dispatched work is finished by its node |

## Checks

```bash
pnpm test:db   # includes tests/integration/server-actions.integration.test.ts
```

The suite proves: typed requests are fenced 1, 2, 3… per server and replay by key; free text, bad names, children, agents, viewers, the wrong permission and other environments are refused; a lifecycle action waits for open work; cancellation is pending-only; direct SQL cannot delete, rewind, rewrite the request, skip to `succeeded` or reuse a fence; `claimNext` dispatches in fence order, `recordResult` stores the server's words and closes the operation, a failed result keeps its failure code, and `expireStale` expires stale work without retrying; the outbox carries one event per transition and requests/cancellations are audited.

## Not yet

Node dispatch over the mTLS transport, execution with the game-control library, route aliases (`/allowlist`, `/kick`, `/start`) and the dashboard buttons. These arrive with A2 once the node agent is on the VPS.
