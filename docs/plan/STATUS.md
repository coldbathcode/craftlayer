# Plan status board

Part of the [master plan](../MASTER_PLAN.md). **Last updated:** 2026-11-08. States are defined in [how to run the plan](RUNNING.md). Detailed engineering history stays in the [delivery status](../delivery/status.md) and [build log](../delivery/build-log.md).

## Where we are right now

- **Family server:** running on the VPS (Paper 26.3 with Geyser/Floodgate). iPads join on port 19133; Java ports stay private. Allowlist enforced.
- **Players:** Alex and Charlie joined from iPads on 2026-11-08. George's account could not be looked up publicly; a temporary server plugin is waiting to record his account on his next attempt so he can be added.
- **Original world:** the old `minecraft-java` server is stopped and untouched, with one encrypted archive on the owner's Mac.
- **Backups:** the new family world has **no backup yet** (Milestone D).
- **Dashboard:** runs only on the owner's Mac; read-only snapshot of the real server; no controls (Milestone A).
- **AI agents:** read-only access works end to end: a scoped key plus the `apps/mcp` server let an MCP client read the real registered VPS server through the local prototype (C1 and C2 built, 2026-11-08). No actions yet (C3), and only from the owner's machine until A1.

## Milestones

| Milestone | State | Next step |
| --- | --- | --- |
| [A — Live connection](A-live-connection.md) | Needs decision | A2 control library done locally; A1 needs the remote-access choice |
| [B — Simple family UI](B-simple-ui.md) | In progress | Owner reviews the B1 draft; then B2 |
| [C — AI agent access](C-ai-agent-access.md) | In progress | Owner connects Claude Desktop (decision 6); C3 needs A3 |
| [D — Backups](D-backups.md) | In progress | D1 durable records (rules done) |
| [E — New servers](E-new-servers.md) | In progress | Engine built; waits on A and D |
| [F — AI built in](F-ai-built-in.md) | Not started | F1 after C3 and B2; F2 needs Chapter 04 authorization |

## Steps

| Step | What | Depends on | State | Evidence / note |
| --- | --- | --- | --- | --- |
| A1 | Host CraftLayer privately on the VPS with two-factor sign-in | Decision 1 | Needs decision | — |
| A2 | Server helper (node agent) on VPS with private control channel | A1 | In progress | 2026-11-08: control library built and proven on a real local Paper boot (typed RCON actions, Bedrock allow by XUID, verified reload, graceful stop); [ADR 0036](../architecture/decisions/0036-game-control-channel.md), [runbook](../development/game-control.md). VPS installation waits for A1 |
| A3 | Real controls: players, kick, message, on/off/restart | A2 | Not started | — |
| A4 | Knock to join | A3 | In progress | 2026-11-08: Knock server plugin and node reader built; plugin compiled against the pinned API and loaded cleanly on a real local Paper boot ([ADR 0037](../architecture/decisions/0037-knock-to-join.md)). Installing on the VPS and the dashboard card wait for A2/B2; a real refusal has not been recorded by it yet |
| B1 | Design and plain-language copy for five screens | — | Built | 2026-11-08: [draft screens, words and error messages](design/family-ui.md); waits for owner review before B2 |
| B2 | Build Home, Server, How to join | B1, A3 | Not started | — |
| B3 | Family and AI helpers screens | B2, C1 | Not started | — |
| B4 | Usability check with a non-technical adult | B2 | Not started | — |
| C1 | Agent tokens (scoped, expiring, revocable) | — | Built | 2026-11-08: migration 0028, API/SDK, [ADR 0035](../architecture/decisions/0035-agent-token-authority.md), [runbook](../development/agent-access.md); unit + database suites pass; no UI (B3) and no agent connected yet |
| C2 | MCP server with read tools (stdio) | C1 | Built | 2026-11-08: `apps/mcp`, SDK 1.32.2, ten read tools; in-memory tests plus a real stdio run against the prototype reading the VPS playtest server, with environment scope and revocation proven; [how to connect](../development/agent-access.md#connect-claude-mcp-read-only). Not yet connected from Claude Desktop itself |
| C3 | Approval-gated agent actions | C2, A3 | Not started | — |
| C4 | Remote MCP on the VPS | C3, A1 | Not started | — |
| D1 | Nightly consistent backup and Back up now | A2 | In progress | Schedule and retention rules done (ADR 0033) |
| D2 | Encrypted off-server copy | D1, Decision 4 | Needs decision | — |
| D3 | Weekly automatic isolated restore test | D1 | Not started | One manual isolated restore of the old world passed (P3) |
| D4 | Adult-approved real restore | D3 | Not started | — |
| E1 | Create-server wizard | A3, B2 | Not started | Family Survival planner exists |
| E2 | Real provisioning on the VPS node | A2, D1 | In progress | Jobs, reservations, approvals built locally; route disabled |
| E3 | Family-appropriate approval rule | Decision 2 | Needs decision | Two-adult approval implemented (ADR 0032) |
| E4 | Decommission with retained backup | E2 | Not started | — |
| F1 | Dashboard assistant | C3, B2, Decision 3 | Not started | Provider gateway built (Chapter 02) |
| F2 | In-game AI helpers | F1, Chapter 04 authorization | Not started | Fleet runtime built (Chapter 03) |

## Decisions needed from the owner

| # | Decision | Options | Recommendation | Blocks |
| --- | --- | --- | --- | --- |
| 1 | How you reach the dashboard from your phone | Tailscale (private network app); Cloudflare Tunnel + Access (email code) | Tailscale: nothing public, free, simple on iPhone/iPad | A1 |
| 2 | Who approves creating servers and restores | Keep two adults; single-owner mode with typed confirmation and a short delay | Single-owner mode if you are the only adult managing it | E3 |
| 3 | Can the dashboard assistant use paid AI | Free models only; allow paid with a monthly cap | Free only to start | F1 |
| 4 | Where off-server backups go | Backblaze B2 (cheap cloud storage); your Mac; another disk | Backblaze B2 | D2 |
| 5 | The original world | Keep stopped; bring it back as a second managed server | Bring back after Milestone D, from a fresh backup | — |
| 6 | Which AI agent to connect first | Claude Desktop; Claude Code; other MCP client | Claude Desktop | C2 how-to |

## Change log

- 2026-11-08 — Master plan created. Family server opened to iPads; Alex and Charlie joined.
- 2026-11-08 — C1 built: agent tokens with a database-enforced read-only allowlist; agents never exceed their creating adult.
- 2026-11-08 — B1 drafted: five screens, plain words and error messages for owner review.
- 2026-11-08 — C2 built: read-only MCP server; migration 0028 applied cleanly to the existing prototype database during the rebuild.
- 2026-11-08 — A2 library built: private RCON game control with typed actions, verified against a real pinned Paper server locally.
- 2026-11-08 — A4 plugin built: allowlist refusals recorded as "asking to join" identities; loads on the real pinned server.
