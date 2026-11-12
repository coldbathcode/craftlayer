# Plan status board

Part of the [master plan](../MASTER_PLAN.md). **Last updated:** 2026-11-12. States are defined in [how to run the plan](RUNNING.md). Detailed engineering history stays in the [delivery status](../delivery/status.md) and [build log](../delivery/build-log.md).

## Where we are right now

- **Family server:** running on the VPS (Paper 26.3 with Geyser/Floodgate). iPads join on port 19133; Java ports stay private. Allowlist enforced.
- **Players:** Alex and Charlie joined from iPads on 2026-11-08. George's account could not be looked up publicly; a temporary server plugin is waiting to record his account on his next attempt so he can be added.
- **Original world:** the old `minecraft-java` server is stopped and untouched, with one encrypted archive on the owner's Mac.
- **Backups:** the new family world has **no backup yet**. Everything needed to take one is now built and tested locally (2026-11-12): the server helper takes the nightly backup and "Back up now", checks the archive and reports it. It starts on the VPS once the helper is live (A2) and a backup folder is approved.
- **Dashboard:** runs only on the owner's Mac; read-only snapshot of the real server; no controls (Milestone A).
- **AI agents:** read-only access works end to end (C1, C2), and agents can now *ask* for typed actions that an adult approves or declines (C3, built 2026-11-08); an approved request becomes a pending server action that waits for the node (A2). Only from the owner's machine until A1.
- **Server helper (node agent):** running on the VPS since the owner approved the host on 2026-11-12 ("Family VPS", checking in every ten seconds). It cannot reach the game yet: that needs a short approved restart to turn on the private control channel, and then the owner choosing **Use this host** for the server.
- **Built but not yet on the VPS (2026-11-12):** the helper can report who is playing and who is asking to join, and can turn the server off, on and restart it. These need the next stack update and three lines in the helper's private configuration.

## Milestones

| Milestone | State | Next step |
| --- | --- | --- |
| [A — Live connection](A-live-connection.md) | In progress | Tailscale on the VPS, two-factor built; deploy the stack next (A1), then A2–A4 go live |
| [B — Simple family UI](B-simple-ui.md) | In progress | Owner reviews the B1 draft; then B2 |
| [C — AI agent access](C-ai-agent-access.md) | In progress | C1–C3 built; owner connects Claude Desktop (decision 6); C4 needs A1 |
| [D — Backups](D-backups.md) | In progress | D1: switch the nightly loop on for the VPS (needs A2 live and a backup folder), then D2 |
| [E — New servers](E-new-servers.md) | In progress | Engine built; waits on A and D |
| [F — AI built in](F-ai-built-in.md) | Not started | F1 after C3 and B2; F2 needs Chapter 04 authorization |

## Steps

| Step | What | Depends on | State | Evidence / note |
| --- | --- | --- | --- | --- |
| A1 | Host CraftLayer privately on the VPS with two-factor sign-in | Decision 1 | In progress | 2026-11-08: Tailscale is on the VPS (owner); two-factor sign-in built and verified (232/232 database cases; [ADR 0042](../architecture/decisions/0042-two-factor-sign-in.md)); server management now allowed for private-HTTPS + required-MFA deployments; [deployment runbook](../operations/vps-dashboard.md). **Done:** stack deployed on the VPS (loopback only), Tailscale HTTPS serving it on the tailnet, owner account created with two-factor enrolled (QR setup added), Family project and world seeded, the family server adopted read-only by the owner. Remaining: a phone-off-home verification and the dashboard database backup job |
| A2 | Server helper (node agent) on VPS with private control channel | A1 | In progress | 2026-11-08: control library proven locally ([ADR 0036](../architecture/decisions/0036-game-control-channel.md)); node agent image target, single-host transport overlay and one-year private PKI prepared ([ADR 0043](../architecture/decisions/0043-single-host-node-transport.md)). 2026-11-12: dispatch built and verified locally over real mTLS (240/240 database cases; [ADR 0044](../architecture/decisions/0044-server-action-dispatch.md)): an adult binds a server to a host, approved actions reach the agent and return with the server's words, never run twice. The VPS stack is updated and verified (game server untouched, no new listener); a later fix the same day let the Hosts page work over Tailscale. The owner approved the host the same day and the agent started by itself. Live status built and verified locally (245/245 database cases; [ADR 0046](../architecture/decisions/0046-live-status-and-knocks.md)): the host reports on/off/starting and player names every ten seconds and stale data is marked. Waiting on the owner: approve a one-minute family-server restart to enable private RCON, then choose **Use this host** for the server. Then a stack update carries live status to the VPS |
| A3 | Real controls: players, kick, message, on/off/restart | A2 | In progress | 2026-11-08: typed, fenced, audited action intake with per-kind adult permissions built and verified (226/226 database cases; [ADR 0040](../architecture/decisions/0040-server-action-intake.md), [runbook](../development/server-actions.md)). 2026-11-12: allow, remove, kick, message and save dispatch to the node (A2). On, off and restart built and verified locally ([ADR 0047](../architecture/decisions/0047-node-power.md)): the host saves, stops the one configured container and checks it; on start it waits for the server to answer. Not configured on the VPS yet; dashboard buttons are B2 |
| A4 | Knock to join | A3 | In progress | 2026-11-08: Knock server plugin and node reader built; plugin compiled against the pinned API and loaded cleanly on a real local Paper boot ([ADR 0037](../architecture/decisions/0037-knock-to-join.md)). 2026-11-12: the host now reports knocks and an adult can allow exactly the refused account or ignore it (API built and verified locally; [ADR 0046](../architecture/decisions/0046-live-status-and-knocks.md)). Installing the plugin on the VPS waits for the approved restart; the dashboard card is B2; a real refusal has not been recorded yet |
| B1 | Design and plain-language copy for five screens | — | Built | 2026-11-08: [draft screens, words and error messages](design/family-ui.md); waits for owner review before B2 |
| B2 | Build Home, Server, How to join | B1, A3 | Not started | — |
| B3 | Family and AI helpers screens | B2, C1 | Not started | — |
| B4 | Usability check with a non-technical adult | B2 | Not started | — |
| C1 | Agent tokens (scoped, expiring, revocable) | — | Built | 2026-11-08: migration 0028, API/SDK, [ADR 0035](../architecture/decisions/0035-agent-token-authority.md), [runbook](../development/agent-access.md); unit + database suites pass; no UI (B3) and no agent connected yet |
| C2 | MCP server with read tools (stdio) | C1 | Built | 2026-11-08: `apps/mcp`, SDK 1.32.2, ten read tools; in-memory tests plus a real stdio run against the prototype reading the VPS playtest server, with environment scope and revocation proven; [how to connect](../development/agent-access.md#connect-claude-mcp-read-only). Not yet connected from Claude Desktop itself |
| C3 | Approval-gated agent actions | C2, A3 | Built | 2026-11-08: tokens carry requestable kinds; agents create requests via MCP; adults approve/decline; approval creates the A3 action as the adult; 230/230 database cases ([ADR 0041](../architecture/decisions/0041-agent-requests.md), [runbook](../development/agent-access.md)). Dashboard card is B3; effect waits for node dispatch |
| C4 | Remote MCP on the VPS | C3, A1 | Not started | — |
| D1 | Nightly consistent backup and Back up now | A2 | In progress | 2026-11-08: rules (ADR 0033) and durable records, permissions, routes and MCP `list_backups` built and verified ([ADR 0038](../architecture/decisions/0038-backup-records.md), [runbook](../development/backups.md)); the archive/verify/restore library is proven on a real local server ([ADR 0039](../architecture/decisions/0039-backup-archive-consistency.md)). 2026-11-12: nightly loop built and verified locally over real mTLS with real archives (243/243 database cases; [ADR 0045](../architecture/decisions/0045-node-backups.md)): the bound helper takes the due backup or "Back up now", verifies it and reports the hashes; never twice, nothing under an emergency stop. Not on the VPS yet: needs A2 live, an approved backup folder and a policy. Remaining after that: deleting expired archives; the button is B2 |
| D2 | Encrypted off-server copy | D1, Decision 4 | Needs decision | — |
| D3 | Weekly automatic isolated restore test | D1 | Not started | One manual isolated restore of the old world passed (P3) |
| D4 | Adult-approved real restore | D3 | Not started | — |
| E1 | Create-server wizard | A3, B2 | Not started | Family Survival planner exists |
| E2 | Real provisioning on the VPS node | A2, D1 | In progress | Jobs, reservations, approvals built locally; route disabled |
| E3 | Family-appropriate approval rule | Decision 2 | Needs decision | Two-adult approval implemented (ADR 0032) |
| E4 | Decommission with retained backup | E2 | Not started | — |
| F1 | Dashboard assistant | C3, B2, Decision 3 | Not started | Provider gateway built (Chapter 02) |
| F2 | In-game AI helpers | F1, Chapter 04 authorization | Not started | Fleet runtime built (Chapter 03) |

## Owner decisions

Decided on 2026-11-08 unless noted.

| # | Decision | Answer | Consequence |
| --- | --- | --- | --- |
| 1 | How you reach the dashboard from your phone | **Tailscale** (free Personal plan; the owner asked whether it is free and it is for a family) | A1 installs Tailscale on the VPS and the owner's devices; the dashboard is served only on the tailnet over HTTPS |
| 2 | Who approves creating servers and restores | **Single-owner mode** with typed confirmation and a short delay | E3 adds the mode behind an ADR; two-adult approval stays available |
| 3 | Can the assistant use paid AI | **Yes, paid and free**: the owner supplies keys for the main foundation models, OpenRouter, Ollama and local providers | F1 uses the existing provider gateway (OpenRouter and Ollama adapters exist; direct adapters are added as needed); free-only remains the default until a key is configured, with budgets and emergency stop |
| 4 | Where off-server backups go | **Must be free** | D2 pulls encrypted archives to the owner's Mac over Tailscale (free) and may add a free-tier bucket later |
| 5 | The original world | **Remove it; keep things fresh** | Its encrypted archive and key stay on the owner's Mac. Removal of the stopped container and `/opt/minecraft-java` is a destructive VPS change: it runs only after a fresh decrypt-and-verify of the archive and one explicit confirmation of the exact scope |
| 6 | Which AI agent to connect first | **Claude Desktop** | Setup steps are in the [agent runbook](../development/agent-access.md#connect-claude-mcp-read-only) |
| 7 | Screen designs (B1) | **Approved** | B2 may start once A3 actions can run |

## Change log

- 2026-11-08 — Master plan created. Family server opened to iPads; Alex and Charlie joined.
- 2026-11-08 — C1 built: agent tokens with a database-enforced read-only allowlist; agents never exceed their creating adult.
- 2026-11-08 — B1 drafted: five screens, plain words and error messages for owner review.
- 2026-11-08 — C2 built: read-only MCP server; migration 0028 applied cleanly to the existing prototype database during the rebuild.
- 2026-11-08 — A2 library built: private RCON game control with typed actions, verified against a real pinned Paper server locally.
- 2026-11-08 — A4 plugin built: allowlist refusals recorded as "asking to join" identities; loads on the real pinned server.
- 2026-11-08 — D1 records built: backup policy revisions, occurrences, evidence, legal holds, health and retention views; 222/222 database cases.
- 2026-11-08 — D1 archive library built: consistent live backup, verification and restore proven on a real local Paper server, including a boot from the restored files.
- 2026-11-08 — A3 intake built: typed server actions (allow, revoke, kick, say, save, start, stop, restart) as durable fenced requests with per-kind permissions.
- 2026-11-08 — C3 built: agents ask, adults approve; MCP request tools; approval creates the real action as the adult.
- 2026-11-08 — Owner's local dashboard rebuilt with migrations 0029–0031; the agent-request flow proven live against the registered VPS server.
- 2026-11-08 — Decisions recorded; Tailscale joined on the VPS by the owner; two-factor sign-in built (A1).
- 2026-11-08 — Dashboard stack deployed on the VPS behind loopback with MFA required; awaiting the owner's Tailscale HTTPS step and first-run.
- 2026-11-08 — Owner signed in over Tailscale with two-factor; QR setup shipped; family server adopted in the VPS instance (A1 essentially complete). A2 transport prepared.
- 2026-11-12 — VPS stack updated to the A2 build; helper staged and waiting for the owner's host approval; private RCON change staged, not run.
- 2026-11-12 — Defect found when the owner tried to approve the host: the Hosts page was still refused on the VPS ("Remote administration requires qualified private entry and MFA") because host routes never received the A1 private-HTTPS-plus-MFA allowance that server routes got. Fixed, tested and deployed to the VPS the same day (game server untouched; backup code present but off).
- 2026-11-12 — D1 nightly loop built: the helper takes the due backup or "Back up now", reads the archive back and reports its hashes; a cut-short backup turns saving back on and is recorded as interrupted. Not switched on for the VPS yet.
- 2026-11-12 — A2 dispatch built: server-to-host binding, signed action polling and results over the private link, a node journal that prevents repeats, operator-set credential lifetime. Two deployment defects found and fixed before the host was ever approved.
- 2026-11-12 — Owner approved the host; the helper started on the VPS. Built locally: live status and player names from the host, asking-to-join with Allow/Ignore, and on/off/restart for one operator-named container.
