# Server actions (intake)

Status: master plan [A3](../plan/A-live-connection.md) intake built on 2026-11-08; node dispatch built and verified locally on 2026-11-12 ([ADR 0044](../architecture/decisions/0044-server-action-dispatch.md)). An action reaches a server only when the server is bound to a connected host whose agent holds that server's private control channel; otherwise it stays `pending` (shown as `awaiting_node`) and expires after ten minutes. Design: [ADR 0040](../architecture/decisions/0040-server-action-intake.md).

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

## Dispatch to a host

| Call | Effect |
| --- | --- |
| `GET /api/v1/servers/{id}/node` | Which host carries out this server's actions, and whether you may change it (`server:read`) |
| `PUT /api/v1/servers/{id}/node` `{node_id}` | Bind an active host in the same project (`server:control` and `node:enroll`, adults only). Binding the same host again changes nothing |
| `DELETE /api/v1/servers/{id}/node` | Release the host. 409 `ACTIONS_STILL_OPEN` while an action is in flight |

The Hosts page shows the same choice as **Servers this host looks after**.

The gateway serves the node's `POST /node/v1/actions/poll` and `/node/v1/actions/result` only with `CRAFTLAYER_NODE_ACTIONS=enabled`. The agent runs actions only for servers listed in its private configuration:

```json
"game_servers": [{
  "server_id": "<server uuid>",
  "rcon_host": "<private address or name on the internal control network>",
  "rcon_port": 25575,
  "rcon_password_file": "/run/craftlayer-node/rcon.password",
  "whitelist_file": "/srv/game/data/whitelist.json",
  "knock_file": "/srv/game/data/plugins/CraftLayerKnock/knocks.jsonl",
  "container": { "compose_project": "<project>", "compose_service": "<service>" }
}]
```

`knock_file` and `container` are optional. Without `knock_file` nobody is ever shown as asking to join; without `container` the host cannot turn the server on or off and cannot tell "off" from "not answering".

`infra/compose/game-control.yml` joins the gateway to an internal Docker network the game server also joins and mounts the server's data directory into the agent. The agent asks for work every two seconds, journals each action before running it and reports the server's own words.

What a failed action means:

| `failure_code` | Meaning |
| --- | --- |
| `server_unreachable` | The control channel did not answer or refused the password; nothing was sent |
| `not_verified` | The server answered but the expected result was not seen afterwards; check the listing |
| `refused_by_server` | The server rejected the request |
| `interrupted` | The host restarted mid-action, the allowlist changed underneath it, or the offer was stale; the outcome may be unknown |
| `node_unavailable` | This host has no `container` configured for the server, or could not reach its container engine |

```bash
pnpm exec vitest run apps/minecraft-node/src/action-worker.test.ts   # journal, worker, runner
pnpm test:db                                                          # binding, dispatch over real mTLS, refusals
```

## Live status and asking to join

Built 2026-11-12 ([ADR 0046](../architecture/decisions/0046-live-status-and-knocks.md)). The host reports each configured server every ten seconds.

| Call | Effect |
| --- | --- |
| `GET /api/v1/servers/{id}/live` | `power` (`on`, `off`, `starting`, `unknown`), player names and counts as the server itself reported them, `allowed` (names on the allowlist file), `reported_at`, and `fresh` (false when the last report is older than 45 seconds or no host is bound) (`server:read`) |
| `GET /api/v1/servers/{id}/knocks` | Accounts refused in the last 24 hours that nobody has decided; no account numbers (`server:read`) |
| `POST /api/v1/server-knocks/{id}/allow` | Adults with `player:manage`; needs an `Idempotency-Key`. Creates the ordinary `allow_player` action for exactly the refused account |
| `POST /api/v1/server-knocks/{id}/ignore` | Adults with `player:manage`. The account asks again only if refused again more than a day later |

## Turning on, off and restarting

Built 2026-11-12 ([ADR 0047](../architecture/decisions/0047-node-power.md)). `start`, `stop` and `restart` are ordinary actions (`server:control`). The host saves the world, stops the one configured container and checks that it stopped; on start it waits up to three minutes for the server to answer. The evidence lists only what the host observed. A power action is refused while other actions are open for the server.

```bash
pnpm exec vitest run apps/minecraft-node/src/lifecycle.test.ts apps/minecraft-node/src/status-reporter.test.ts
pnpm test:db   # live status, knocks and power over real mTLS with a scripted server
```

## Not yet

Route aliases (`/allowlist`, `/kick`, `/start`) and a phone notification when someone asks to join. None of this is switched on for the family VPS until the owner steps on the [status board](../plan/STATUS.md) are done.
