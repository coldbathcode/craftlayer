# Connect an AI agent (read-only)

Status: master plan steps [C1 and C2](../plan/C-ai-agent-access.md) are built and locally verified. Agents can read through the MCP server below; they cannot change anything yet (C3). Design: [ADR 0035](../architecture/decisions/0035-agent-token-authority.md).

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

Tools, all read-only: `get_connection_info`, `list_projects`, `list_environments`, `list_servers`, `get_server_status`, `list_players`, `get_operation_status`, `list_nodes`, `get_node_capacity`, `list_server_templates`. Each call is an ordinary API request with the agent's token, so scope, permissions and audit apply exactly as for a person. Ask Claude "Who is on Family Survival?" and it will call `list_servers` or `get_server_status`; the answer reports the *last observation* and says so. `list_backups` reads the backup policy, schedule health and recorded backups; it says so plainly when a server has no policy or no verified backup.

The server writes nothing to stdout except protocol frames; a startup problem is printed to stderr in one line without the token.

## Audit

Creating and revoking a token are audited as `agent_token.created` and `agent_token.revoked` with the adult as actor. Denied agent requests are audited with `agent_id` in the details, so you can see which agent was refused.

## Limits

- No MCP server yet; this is the credential it will use.
- No agent actions, requests or approvals yet (C3).
- Tokens are organisation-scoped and reach the API only where the API is reachable: today that is the owner's machine. Remote use waits for the private access layer (A1) and remote MCP (C4).
- Verification so far is the local database/API suite; no agent client has been connected.
