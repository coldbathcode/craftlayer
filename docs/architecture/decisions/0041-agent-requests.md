# ADR 0041 — Agents ask, adults approve

Status: adopted for master plan step C3, 2026-11-08. Built and verified in the database and MCP suites. No agent request can reach a server until the A3 node dispatch exists, and no dashboard card shows requests yet (B3).

## Context

Read-only agent access (ADRs 0035 and 0036) lets Claude see a family server. The plan requires that an agent can *ask* for changes while a parent stays in charge: no model text or tool call may itself allow a player, kick, stop or message. A3 (ADR 0040) now provides typed, audited server actions that an adult requests; agents need a safe way to propose exactly those.

## Decision

1. **Requestable kinds live on the token.** An adult creating an agent token may list the action kinds it is allowed to request (`may_request`, a subset of the A3 kinds). The creator may only list kinds whose permission they themselves hold in the token's scope. The list is immutable for the token's life and enforced by a SQL CHECK and an insert trigger: a request row cannot exist for a kind its token does not carry.
2. **A request is a proposal, not an action.** `minecraft_agent_requests` stores the typed action (the same strict contract as A3), the agent's one-line `reason` (untrusted; shown to the adult as plain text), and forward-only state `pending → approved | declined | cancelled | expired` with a 24-hour expiry and at most 20 open per agent. Only an agent principal may create one, only where it can read the server; same-key replay returns the same request and a changed body conflicts.
3. **Approval is the adult's own action.** An adult with the action's permission (`player:manage` or `server:control`) in that environment approves or declines. Approval first creates the A3 server action **as that adult**, under the request ID as idempotency key, then records the decision pointing at the action. The audit shows `server.agent_request_created` with the agent's ID and `server.agent_request_approved` with the deciding adult as actor and the requesting agent in the details. Agents, children and viewers cannot decide; an agent may only cancel its own pending request.
4. **MCP tools are requests.** `request_allow_player`, `request_revoke_player`, `request_kick_player`, `request_server_message`, `request_server_start|stop|restart|save` and `list_my_requests` call the request API with the agent's token. Their annotations mark them non-read-only but non-destructive, and every reply says that nothing happens until an adult approves. The MCP client gained a single POST path with an idempotency key; it still refuses any path outside `/api/v1`.

## Consequences

- The B3 "AI helpers" screen shows pending requests with Approve/Decline; until then adults use the API.
- Once A3 dispatch runs on the node, an approved request becomes a real action within seconds; until then it stays `pending` and `awaiting_node`.
- Backups are not requestable yet; `create_backup` as an agent request needs the backup effect first (D1 loop).
