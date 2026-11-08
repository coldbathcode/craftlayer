# ADR 0034 — Master plan: usable first, agent access early

Status: adopted for planning, 2026-11-08. Grants no implementation, production or Chapter 04 scope by itself.

## Context

The owner reviewed the running system. The family server works and children joined from iPads, but the dashboard has no controls over the real server, its design is too technical for everyday use, and AI agents have no access. Every real change so far was made over SSH. The existing order (finish F2 identity and backups, then F2.5 provisioning with the MCP subset, then F3 lifecycle) delays the first usable control and puts agent access late.

## Decision

Adopt the [master plan](../../MASTER_PLAN.md) and its [status board](../../plan/STATUS.md) as the single place for order and user outcome:

1. **Live connection first (A).** Host CraftLayer privately on the VPS and install the existing node agent with a private control channel, so typed actions reach the real owned server. Lifecycle for the CraftLayer-owned playtest deployment moves ahead of general F3 lifecycle, because that server is ours by ownership labels, not an adopted pre-existing container.
2. **Simple UI (B).** Plain-language Home/Server/Join screens become the default; existing consoles move under Advanced.
3. **Agent access early (C).** Scoped agent tokens and a local stdio MCP server with read tools move ahead of F2.5 completion. Mutating tools wait for real controls and always route through adult approval.
4. **Backups (D)** continue CL-F2-03; **provisioning (E)** completes F2.5; **AI built in (F)** adds a dashboard assistant and then Chapters 04–06.

## Safety unchanged

Every AGENTS.md invariant stands: allowlist and online authentication on, no public admin ports, no world change without backup and approval, children cannot manage, agents cannot self-approve, free-only inference by default, emergency stop outranks all. Remote dashboard access requires two-factor sign-in behind a private access layer. Reordering moves work earlier; it does not remove any release gate. Existing task IDs and chapter evidence are preserved and mapped in the master plan.

## Consequences

Owner decisions (remote-access method, approval rule for a single-adult family, paid inference, off-site backup destination) now block specific steps and are tracked on the status board. A single-owner approval mode, if chosen, needs its own ADR because it changes ADR 0032.
