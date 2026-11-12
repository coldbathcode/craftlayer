# Connect an AI agent (read-only)

Status: master plan steps [C1 to C3](../plan/C-ai-agent-access.md) are built and locally verified, and the remote transport (C4) is built but not deployed. Agents read through the MCP server below and can ask for changes that an adult approves. Design: [ADR 0035](../architecture/decisions/0035-agent-token-authority.md).

## What an agent token is

A scoped key an adult creates for one AI agent. It names the agent, lists the read permissions it may use, points at one project (or one world inside a project) and expires within 90 days. The secret starts with `cla_` and is shown exactly once. Anyone with `agent:connect` (organisation administrators by default) can list and revoke tokens; revocation takes effect on the next request.

An agent can never do more than the adult who created the key can do at that moment. If that adult is demoted, suspended or disabled, the agent stops working too.

## Create, list and revoke

There is no screen yet (that is step B3). Use the API with an adult browser session, or the SDK's `agentTokenClient`:

```bash
# Create (adult session cookie and CSRF token required, as for any browser write)
curl -sS -X POST "$CRAFTLAYER/api/v1/agent-tokens" \
  -H "cookie: craftlayer_session=$SESSION" -H "x-csrf-token: $CSRF" \
  -H "origin: $CRAFTLAYER" -H "x-craftlayer-organization: $ORG" \
  -H "content-type: application/json" \
  -d '{"name":"Claude on my laptop","permissions":["organization:read","project:read","environment:read","server:read","player:read","operation:read"],"projectId":"<project uuid>","expiresInDays":30}'
```

The response contains `token` once. Store it in the agent's own secret store; CraftLayer keeps only a hash and cannot show it again. `GET /api/v1/agent-tokens` lists tokens with `state` active, expired or revoked. `DELETE /api/v1/agent-tokens/{id}` revokes. Names are unique among tokens that have not been revoked, so revoke an expired token before reusing its name.

Permissions an agent may carry: `organization:read`, `project:read`, `environment:read`, `server:read`, `player:read`, `operation:read`, `node:read`, `event:read`, `mission:read`, `agent:read`. Nothing else is accepted, by the API or by the database.

## Use the token

Send it as a bearer header with the organisation header. No cookie, CSRF or Origin header is needed:

```bash
curl -sS "$CRAFTLAYER/api/v1/servers?environment_id=<world uuid>" \
  -H "authorization: Bearer cla_…" -H "x-craftlayer-organization: $ORG"
```

Reads outside the token's project or world return 403; another organisation returns 404; an expired or revoked token returns 401. Any write returns 403 `PERMISSION_DENIED`. Provider-credential routes ignore agent bearers entirely.

## Connect Claude (MCP, read-only)

`apps/mcp` is a Model Context Protocol server that speaks stdio and reads CraftLayer with one agent token. Build once with `pnpm build:server`, then point a client at `apps/mcp/dist/main.js` with three environment variables:

| Variable | Value |
| --- | --- |
| `CRAFTLAYER_URL` | Where CraftLayer runs; `http://127.0.0.1:3000` by default (the prototype uses port 3001). Anything off this machine must be `https`. |
| `CRAFTLAYER_ORGANIZATION` | Your family's organization ID (`GET /api/v1/organizations`). |
| `CRAFTLAYER_AGENT_TOKEN` | The `cla_…` secret from the step above. |

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "craftlayer": {
      "command": "node",
      "args": ["/absolute/path/to/craftlayer/apps/mcp/dist/main.js"],
      "env": {
        "CRAFTLAYER_URL": "http://127.0.0.1:3001",
        "CRAFTLAYER_ORGANIZATION": "<organization uuid>",
        "CRAFTLAYER_AGENT_TOKEN": "cla_…"
      }
    }
  }
}
```

**Claude Code**: `claude mcp add craftlayer -e CRAFTLAYER_URL=http://127.0.0.1:3001 -e CRAFTLAYER_ORGANIZATION=<uuid> -e CRAFTLAYER_AGENT_TOKEN=cla_… -- node /absolute/path/to/craftlayer/apps/mcp/dist/main.js`

Read tools: `get_connection_info`, `list_projects`, `list_environments`, `list_servers`, `get_server_status`, `list_players`, `list_backups`, `get_operation_status`, `list_nodes`, `get_node_capacity`, `list_server_templates`, `list_my_requests`. Request tools (only if the token carries the kind): `request_allow_player`, `request_revoke_player`, `request_kick_player`, `request_server_message`, `request_server_start`, `request_server_stop`, `request_server_restart`, `request_server_save`. Each call is an ordinary API request with the agent's token, so scope, permissions and audit apply exactly as for a person. Ask Claude "Who is on Family Survival?" and it will call `list_servers` or `get_server_status`; the answer reports the *last observation* and says so. `list_backups` reads the backup policy, schedule health and recorded backups; it says so plainly when a server has no policy or no verified backup.

The server writes nothing to stdout except protocol frames; a startup problem is printed to stderr in one line without the token.

## Remote MCP (C4)

Status: built and verified locally; **not deployed on the VPS**. Design: [ADR 0048](../architecture/decisions/0048-remote-mcp.md).

The same tools are also served over Streamable HTTP by a second entry point, `apps/mcp/dist/remote-main.js`, so an agent on any family device can connect without a checkout of this repository. It is meant to run as a container on the VPS (`infra/compose/mcp.yml`), listening on the host's loopback only and reached through Tailscale HTTPS. It is never given a public port.

The service holds **no token**. Every request must carry the caller's own agent token as `Authorization: Bearer cla_…`; the service forwards it to the API, which decides scope, expiry and revocation on every tool call. A revoked token fails on its next call. The organization is fixed by the service's configuration (one family per deployment); the API still refuses a token from another family.

| Variable | Default | Meaning |
| --- | --- | --- |
| `CRAFTLAYER_ORGANIZATION` | required | The family's organization ID. Compose reads it from `CRAFTLAYER_MCP_ORGANIZATION`. |
| `CRAFTLAYER_URL` | `http://127.0.0.1:3000` | The API the calls are forwarded to. Must be `https` unless it is this machine. Compose uses `http://api:4000`. |
| `CRAFTLAYER_MCP_INTERNAL_API_HTTP` | `false` | `true` allows plain HTTP to an API on a private container network. Compose sets it. |
| `CRAFTLAYER_MCP_BIND_HOST` | `127.0.0.1` | Listen address. Anything but loopback is refused. |
| `CRAFTLAYER_MCP_ALLOW_NON_LOOPBACK_BIND` | `false` | `true` lifts that refusal. Compose sets it because the container port is published on the host's `127.0.0.1` only. Do not set it anywhere else. |
| `CRAFTLAYER_MCP_PORT` | `3900` | Listen port. On the host, Compose publishes `127.0.0.1:${CRAFTLAYER_MCP_HTTP_PORT:-3900}`. |
| `CRAFTLAYER_MCP_ALLOWED_HOSTS` | `127.0.0.1,localhost,[::1]` | Hostnames accepted in the `Host` header, without ports. Set it to the tailnet name. Required by Compose. |
| `CRAFTLAYER_MCP_ALLOWED_ORIGINS` | empty | Exact browser origins accepted in `Origin`. Empty refuses every request that has an `Origin`; desktop and command-line clients send none. |
| `CRAFTLAYER_MCP_RATE_PER_TOKEN` | `60` | Requests per minute for one token. |
| `CRAFTLAYER_MCP_RATE_GLOBAL` | `300` | Requests per minute for everyone together, counted before the token is checked. |
| `CRAFTLAYER_MCP_MAX_BODY_BYTES` | `65536` | Largest request body (at most 4 MiB). |
| `CRAFTLAYER_MCP_REQUEST_TIMEOUT_MS` | `30000` | A request is abandoned after this long (at most two minutes). |

What a caller sees when refused: `401` with `WWW-Authenticate: Bearer` (no or malformed token), `403` (`Host` or `Origin` not allowed), `429` with `Retry-After` (too many requests), `413` (body too large), `504` (took too long), `405` (anything but `POST /mcp`). A token the API rejects is not an HTTP error: the tool answers with a plain message such as "The agent token is invalid, expired or revoked". `GET /health/live` answers `{"status":"ok"}` for the container health check. The service logs one line of codes per request and never a token, body, tool name or argument.

Run it locally against a running CraftLayer with `CRAFTLAYER_ORGANIZATION=<uuid> CRAFTLAYER_URL=http://127.0.0.1:3001 node apps/mcp/dist/remote-main.js` after `pnpm build:server`; the endpoint is then `http://127.0.0.1:3900/mcp`.

### Connect a client to the remote address

The device must be on the family tailnet. The address is whatever `tailscale serve` publishes, for example `https://<machine>.<tailnet>.ts.net:8443/mcp` (see the [VPS steps](../operations/vps-dashboard.md#remote-mcp-master-plan-c4)).

**Claude Code**:

```bash
claude mcp add --transport http craftlayer https://<machine>.<tailnet>.ts.net:8443/mcp \
  --header "Authorization: Bearer cla_…"
```

This stores the token in Claude Code's configuration on that device. Use a token created for that device, so it can be revoked on its own.

**Claude Desktop**: the built-in "custom connector" screen connects from Anthropic's servers, which are not on your tailnet and cannot reach this address, and it expects OAuth, which this endpoint does not offer. Two options work:

- Keep using the local stdio server described above, pointed at the tailnet dashboard address (`CRAFTLAYER_URL=https://<machine>.<tailnet>.ts.net`).
- Or bridge stdio to the remote address with a local proxy in `claude_desktop_config.json`. This example uses the third-party `mcp-remote` package, which this project does not vet or pin; read it before trusting it with a token:

```json
{
  "mcpServers": {
    "craftlayer": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<machine>.<tailnet>.ts.net:8443/mcp",
        "--header",
        "Authorization:${CRAFTLAYER_AUTH}"
      ],
      "env": { "CRAFTLAYER_AUTH": "Bearer cla_…" }
    }
  }
}
```

Any other MCP client works if it speaks Streamable HTTP and can send a fixed `Authorization` header. Sessions and server-sent streams are not used.

## Let an agent ask for changes (requests)

A token may carry `mayRequest`: the action kinds the agent is allowed to *ask* for (`allow_player`, `revoke_player`, `kick_player`, `say`, `save`, `start`, `stop`, `restart`). You can only list kinds you could approve yourself in that scope. The agent then has MCP tools such as `request_allow_player` and `request_server_stop`; each creates a request that waits for an adult. Decide with `POST /api/v1/agent-requests/{id}/decide` (`{"decision":"approve"}` or `"decline"`, optional `note`); approving creates the real server action in your name. Requests expire after 24 hours; the agent can cancel its own; `GET /api/v1/servers/{id}/agent-requests` lists them (an agent sees only its own). Design: [ADR 0041](../architecture/decisions/0041-agent-requests.md). Until the node agent is installed on the VPS, an approved request's action stays pending.

## Audit

Creating and revoking a token are audited as `agent_token.created` and `agent_token.revoked` with the adult as actor. Denied agent calls are audited with `agent_id` in the details, so you can see which agent was refused. Requests add `server.agent_request_created` (actor: the token's creating adult, with `agent_id`), `server.agent_request_approved` / `declined` (actor: the deciding adult, with `requesting_agent_id` and, on approval, the `action_id`) and `server.agent_request_cancelled`.

## Limits

- Remote MCP is built but not deployed; until the VPS steps are done, agents connect with the local stdio server.
- The remote endpoint offers a fixed bearer header only. There is no OAuth sign-in or discovery, so it must stay behind the private access layer.
- One family per remote deployment; rate limits are in memory and reset when the service restarts.
- The dashboard screen for creating tokens is step B3; until then tokens are created through the API.
