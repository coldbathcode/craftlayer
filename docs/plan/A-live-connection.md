# Milestone A — Live connection to the real server

Part of the [master plan](../MASTER_PLAN.md). Status lives on the [status board](STATUS.md).

## Goal

Pressing a button in CraftLayer changes the real Minecraft server, safely, and the screen shows what actually happened.

## Why it is missing today

The dashboard runs only on the owner's Mac. The game runs on the VPS. Nothing connects them except an engineer's SSH session. The node agent (CL-F25-01) exists and is tested locally, but it is not installed on the VPS and has no game actions yet. The server has no console or private control channel, so even adding a player needs a restart.

## Steps

### A1 — Host CraftLayer privately on the VPS

Run the CraftLayer stack (web, API, worker, database, Redis) as its own Compose project on the VPS, bound to loopback only. Reach it from the owner's phone and laptop through a private access layer, never a public port.

- Owner decision 1 (2026-11-08): **Tailscale**. The VPS and the owner's devices join one tailnet; the dashboard is served only there over HTTPS (`tailscale serve`), so no public port is opened. See [decisions](STATUS.md#owner-decisions).
- Add TOTP two-factor sign-in for adults (closes the F1 remote-entry/MFA gate).
- Migrate the prototype's real records (the two registered servers) or start fresh; generated prototype passwords are not reused.
- Separate database volume, own backup of the CraftLayer database (pg_dump nightly, retained), resource limits so it cannot starve the game.
- **Done when:** the owner signs in from a phone off the home network with two-factor; the stack survives a reboot; no new public port is open (checked from outside).
- **Approval needed:** VPS write approval for the new Compose project and access layer.

### A2 — Server helper next to the game

Install the existing node agent on the VPS in its own container, enrolled with a one-use code, connecting to the API over the private Docker network (mTLS, signed commands — already built).

- Give the game server a **private control channel**: enable RCON bound only to an internal Docker network shared with the node agent, password generated and held only by the agent. Never published to the host.
- The agent gets typed, fixed actions only — no raw commands from callers. *The library for this is built and proven locally (2026-11-08): see [ADR 0036](../architecture/decisions/0036-game-control-channel.md) and the [game control runbook](../development/game-control.md).*
- **Done when:** dashboard shows live status and the real player list within 10 seconds of a change; RCON is unreachable from the host's public interface and from other containers; the agent cannot touch other projects' containers.
- **Approval needed:** restart of the family server (about 1 minute) to enable the private channel.

### A3 — Real controls

Typed actions, each a durable operation with audit, idempotency and a truthful result:

| Action | How it works | Who can |
| --- | --- | --- |
| See status, players | RCON `list`, query | Adults, viewers |
| Add / remove a player | Resolve Xbox or Java account, write allowlist, `whitelist reload` — no restart | Adults |
| Kick a player | RCON `kick` | Adults |
| Send a message | RCON `say`, length-limited, no command characters | Adults |
| Turn on / off / restart | Agent starts or stops only containers carrying this deployment's ownership labels; graceful stop with save | Adults |
| Back up now | See [Milestone D](D-backups.md) | Adults |

- Every action re-checks permission in the API, the domain service and the agent (defence in depth, existing pattern). *The request side is built (2026-11-08): [ADR 0040](../architecture/decisions/0040-server-action-intake.md), [runbook](../development/server-actions.md); dispatch to the node follows A2.*
- Emergency stop still outranks everything.
- **Done when:** each action works end to end on the real server, the audit shows who did it, a child account is refused at the API, and repeating a request does not repeat the effect.

### A4 — Knock to join

Some Xbox gamertags cannot be looked up publicly (George's could not). Turn the temporary join probe into a feature:

- A small server plugin records refused join attempts (gamertag plus the account ID Xbox sign-in proved). The agent reports them.
- The Players screen shows "**BigCrazyPickle tried to join 2 minutes ago — Allow / Ignore**". Allow adds that exact proven account. No typing account numbers, no restart.
- Knocks expire after 24 hours; nothing is granted automatically; spam is rate-limited.
- **Done when:** an unknown account knocks, the parent taps Allow, and the child joins on the next try; an ignored knock never gets in.

## Risks

- Hosting the dashboard on the same VPS as the game: a dashboard compromise is closer to the game. Mitigation: separate containers, no Docker socket in web/API, node agent is the only privileged piece (ADR 0016).
- Another project's containers share the VPS. The agent's allowed actions are restricted to CraftLayer ownership labels; tests must prove it cannot list or stop the other project's containers beyond counts.
