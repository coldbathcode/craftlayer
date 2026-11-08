# Connect an AI agent (read-only)

Status: master plan step [C1](../plan/C-ai-agent-access.md) is built and locally verified. Agents can read; they cannot change anything yet. The MCP server (C2) that lets Claude use these tokens is the next step. Design: [ADR 0035](../architecture/decisions/0035-agent-token-authority.md).

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

## Audit

Creating and revoking a token are audited as `agent_token.created` and `agent_token.revoked` with the adult as actor. Denied agent requests are audited with `agent_id` in the details, so you can see which agent was refused.

## Limits

- No MCP server yet; this is the credential it will use.
- No agent actions, requests or approvals yet (C3).
- Tokens are organisation-scoped and reach the API only where the API is reachable: today that is the owner's machine. Remote use waits for the private access layer (A1) and remote MCP (C4).
- Verification so far is the local database/API suite; no agent client has been connected.
