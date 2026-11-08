# Milestone B — Simple family UI

Part of the [master plan](../MASTER_PLAN.md). Status lives on the [status board](STATUS.md).

## Goal

Someone who has never heard of Docker or RCON can run the family server from a phone without help. Every screen answers a plain question.

## Problems with the current screens

The current `/servers` and `/nodes` consoles (about 2,000 lines) were built to prove engineering contracts. They show captures, provenance, freshness windows, plan hashes, reservation states and adoption metadata. These are useful to engineers and confusing to everyone else.

## Design principles

1. **Plain words.** "On / Off / Starting", "Playing now", "Last backup: today 4:00 ✓". No internal terms on the main screens.
2. **One main action per card.** Big buttons, thumb-sized, mobile first.
3. **Say what happened.** After a tap: "Turning off… saved the world… Off." If something fails: what it means and what to do.
4. **Safe by default.** Destructive actions ask in plain language ("Turn off Family Survival? Alex and Charlie will be disconnected.").
5. **Advanced is one tap away, never in the way.** The existing technical views move under **Advanced** for adults who want them.
6. **Same rules underneath.** UI hides what a role can't do, but the API still enforces it.

## Screens

**Home** — one card per server: name, On/Off, who's playing, last backup ✓/⚠, and buttons: **Players**, **Turn on/off**, **How to join**. A banner appears only when something needs attention ("George is asking to join", "Backup failed last night").

**Server** — tabs:
- **Players**: who can join (name, edition icon, last seen), **Add player** (type gamertag; Java or Bedrock auto-detected where possible), knock requests with **Allow / Ignore**, remove with confirmation, who's online now with **Kick**.
- **Power**: Turn on, Turn off, Restart, with live progress.
- **Backups**: last backup, **Back up now**, list of backups, **Restore** (adult, with approval and a plain warning).
- **How to join**: address, port and step-by-step iPad / Java instructions with pictures; share button.
- **Advanced**: today's technical console.

**New server** — 3-question wizard: name, game mode (Survival / Creative), who can play (pick from family players). Shows "This will use about 3 GB of memory; you have 9 GB free." Then **Create**. See [Milestone E](E-new-servers.md).

**Family** — adults and children, roles in plain words ("Can manage", "Can watch", "Child — plays only").

**AI helpers** — connected agents, what each may do, pending agent requests to approve. See [Milestone C](C-ai-agent-access.md).

## Steps

- **B1 — Design and copy.** *Drafted 2026-11-08:* [screens, words and error messages](design/family-ui.md). Review with the owner before building. No code.
- **B2 — Build Home, Server and How to join** on the existing Next.js app and typed SDK, wired to Milestone A actions. Old consoles move to `/advanced`.
- **B3 — Family and AI helpers screens.**
- **B4 — Usability check.** The owner (and ideally a non-technical adult) does five tasks unaided: check who's on, let a new player in, turn the server off and on, back up now, find join instructions. Record time and confusion points; fix and repeat.
- **Done when:** all five tasks succeed unaided on a phone; Playwright journeys cover adult, viewer and child roles; accessibility checks pass (labels, contrast, keyboard, screen reader).
