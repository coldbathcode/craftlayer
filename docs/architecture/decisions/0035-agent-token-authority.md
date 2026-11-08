# ADR 0035 — Agent token authority

Status: adopted for master plan step C1, 2026-11-08. Read-only agent access only; no agent action, approval or MCP transport is enabled by this decision.

## Context

External AI agents (Claude Desktop, Claude Code, other MCP clients) need to read family server state without a browser session, and later ask for actions an adult approves. The existing identity model has only browser sessions (cookie plus CSRF) and worker bearer identities for the simulation runtime. A browser session is not an agent credential, and giving an agent a human account would hide who did what and make revocation coarse.

## Decision

1. **Agents are a distinct principal.** An adult with the new organization permission `agent:connect` creates an **agent token**: a name, an allowlisted permission set, one project or one environment, and an expiry of at most 90 days (30 by default). The secret (`cla_` plus 43 URL-safe characters) is shown once and stored only as a SHA-256 hash. Revocation is immediate and final; rows are retained for audit.
2. **A token can only narrow its creator.** At every use, the agent's authority is the token's permissions intersected with what the creating adult can do *right now* in the token's scope (`narrowAgentAuthority` in `@craftlayer/core`). Agents are never administrators, hold no roles and are never children. Demoting, suspending or disabling the adult therefore disables the agent. A creator may only hand out permissions they currently hold in that scope.
3. **The allowlist is enforced twice.** `agentTokenPermissions` in code and a SQL `CHECK` on `agent_tokens.permissions` carry the same read-only list (`organization`, `project`, `environment`, `server`, `player`, `operation`, `node`, `event`, `mission`, `agent` reads). Management, approval, credential, network, enrolment, provisioning and `agent:connect` itself can never be carried by a token, so agents cannot mint agents. A unit test keeps contracts, core and SQL identical.
4. **One door.** Agent tokens arrive as `Authorization: Bearer cla_…` and flow through the same `AuthService.orgAction` path, so every domain service, route and later MCP tool applies the same permission checks. A bearer is explicit authority, so the ambient-cookie protections (Origin and CSRF) do not apply to it; the provider-credential routes deliberately never read it.
5. **Agents cannot act as people.** Session management, organization creation, instance-owner operations, invitation acceptance and sealed execution grants refuse agent principals outright. `GET /auth/me` for an agent shows only its own organization and never owner status.
6. **Attribution.** Audit records keep the creating adult as actor and add `agent_id` in details, so the audit answers both "who authorised this agent" and "which agent did it".

## Consequences

- Reads by agents work against the current registry immediately and against live data when Milestone A lands.
- Actions by agents (C3) will not widen this allowlist. They will create *agent requests* that an adult approves; the approval, not the agent, carries the acting permission.
- A remote MCP transport (C4) must validate these tokens the same way and sits behind the private access layer from A1.
- The schema is migration 0028; the Drizzle table is documentation only, as elsewhere in this repository.
