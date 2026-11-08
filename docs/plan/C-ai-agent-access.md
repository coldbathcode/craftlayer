# Milestone C — AI agent access (priority)

Part of the [master plan](../MASTER_PLAN.md). Status lives on the [status board](STATUS.md).

## Goal

An AI agent such as Claude can connect to CraftLayer, see the family servers, and ask to do things. The parent stays in charge: agents get only the permissions the parent grants, risky actions wait for a one-tap approval, and everything is in the audit log.

## Design

- **Agents are their own accounts.** An adult creates an **agent token** in the dashboard: a name ("Claude on my laptop"), a set of allowed abilities, the servers it can see, and an expiry. The token is shown once, stored hashed, revocable instantly. Agents can never be granted child-management, credential, network or approval permissions.
- **One door, same rules.** MCP tools call the same domain services as the API and UI. MCP is never a back door.
- **Agents ask, adults approve.** Low-risk reads run immediately. Actions that change things create an **agent request** the parent sees in the dashboard (and, later, as a phone notification): "Claude wants to let BigCrazyPickle join Family Survival — Approve / Decline". The agent cannot approve its own request; a model's text is never an approval.
- **Transport.** Start with local **stdio** MCP (the agent runs on the owner's machine with a scoped token, reaching the API privately). Then **Streamable HTTP** on the VPS behind the private access layer with OAuth-style token validation, as required by the [management architecture](../architecture/minecraft-management.md).
- **Official TypeScript MCP SDK**, version pinned at implementation, in a new `apps/mcp` package.

## Tools

| Tool | Phase | Effect |
| --- | --- | --- |
| `list_servers`, `get_server_status`, `list_players`, `get_operation_status` | C2 | Read |
| `list_backups`, `list_nodes`, `get_node_capacity`, `list_server_templates` | C2 | Read |
| `allow_player`, `revoke_player`, `kick_player` | C3 | Creates agent request; runs after adult approval |
| `start_server`, `stop_server`, `restart_server`, `create_backup` | C3 | Adult may pre-allow per agent; otherwise approval |
| `provision_minecraft_server` | E | Always needs adult approval |
| Restore, delete, firewall, credentials | — | Not available to agents |

## Steps

- **C1 — Agent tokens.** *Built 2026-11-08.* Hashed scoped tokens with expiry, create/list/revoke API and SDK client, audit with `agent_id` details. The allowlist is enforced in code and by a SQL CHECK; a token only narrows its creating adult's current authority. Database tests cover scope, cross-tenant denial, expiry, revocation, creator demotion and direct-SQL tampering. The management screen is part of B3. See [ADR 0035](../architecture/decisions/0035-agent-token-authority.md) and the [runbook](../development/agent-access.md).
- **C2 — MCP read tools.** `apps/mcp` with stdio transport and the read tools above. Works against the current registry immediately and against live data once [A2](A-live-connection.md) lands. Includes a how-to for connecting Claude Desktop and Claude Code.
- **C3 — Approval-gated actions.** Agent request model, dashboard approval card, per-agent pre-allow for low-risk actions, MCP action tools. Needs [A3](A-live-connection.md) for real effects.
- **C4 — Remote MCP.** Streamable HTTP endpoint on the VPS behind the private access layer, token validation, rate limits.
- **Done when:** Claude, connected with a read-only token, correctly answers "Who's on Family Survival?"; with an action token it requests "allow George", the parent approves on a phone, and George can join; a revoked token stops working immediately; a child-scoped or other-family request is refused.

## Why this can start now

C1 and C2 need no VPS change and no new game capability. They reuse the existing identity, permission and audit foundations, so they can be built in parallel with Milestone A.
