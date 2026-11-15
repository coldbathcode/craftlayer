# ADR 0053 — AI player records, worker hosts and per-player spending

Status: adopted 2026-11-15 for master plan step G3. Builds on [ADR 0051](0051-ai-player-harness.md) and [ADR 0052](0052-ai-player-model-access.md).

## Context

An AI player needs a profile the owner controls, a process that plays it, a way to talk to it, a memory, master tasks and a hard spending limit. The process runs for hours, possibly on another machine, and must never hold provider keys or game-server authority (ADR 0016).

## Decision

1. **Profiles.** `ai_players` holds the name, persona, rules, chosen connection and model, game address and protocol, Minecraft username and sign-in mode, the owner's in-game instructor identities, the daily and total limits (micro-USD), calls per hour, desired state and a stop latch. The creating adult and their membership are recorded; a call runs on that adult's standing (ADR 0052). Changing the model re-checks that it is an approved model with tool support. Only adults with `ai_player:manage` in the player's project see or change it; children never can.
2. **Worker hosts.** An adult creates a host and receives its token once: `clah_<organization>_<host>_<32 random bytes>`. Only a SHA-256 hash is stored. The token resolves only within the organization it names, so a guessed organization alone grants nothing. A host sees and acts for only the players assigned to it. Revoking a host stops and unassigns its players. Host routes live under `/api/v1/ai-player-host/` and accept only the bearer token, never a browser session.
3. **Stop latches.** Stop sets `desired_state='stopped'` and `stop_latched=true` in one update. While latched, the host receives `run: false`, no instructions and no model calls. Start is refused until an adult clears the latch, and clearing never starts the player.
4. **Model calls (`think`).** The host sends messages, tool schemas and token bounds; the service decides model, credentials and limits. In order:
   - refuse if stopped or over calls per hour;
   - refresh the chosen model's price snapshot if it is older than four minutes;
   - reserve the worst case (`maximumCost`) against the player's UTC-day and total limits in one transaction;
   - call `generateStanding`;
   - settle.

   The player's charge is the **observed** token counts at the reserved price snapshot. When usage is not reported, or the outcome is unknown after dispatch, the worst case stays spent. A call that never dispatched is released.
5. **Conversation and memory.** `ai_player_messages` holds instructions, replies, events, decisions and system notes (the newest 2000 per player). Instructions wait until the host takes them, exactly once. In-game chat from an owner identity is recorded as an already-delivered instruction. `ai_player_memories` holds facts, places, people, lessons, notes and summaries. The owner can add and forget any memory; the player's own memories are capped at 400 (oldest dropped) and the owner's are never pruned. Master tasks (up to 32) are replaced as a set.
6. **Status.** The host reports state and a bounded observation (position, health, food, activity, inventory, nearby players, and a pending Microsoft sign-in code). The owner sees it marked stale after 30 seconds. It is never authority for anything.

## Consequences

- **Two spend figures.** The provider ledger books every settled call at no less than its reservation (Chapter 02's conservative estimate), so the organization, user and project **hourly** limits fill at the worst-case rate. The player's own figures use observed usage. Owners should set hourly budgets with headroom; the runbook says so.
- The player's limit check happens before dispatch, so concurrent calls cannot overshoot it. A call whose result is lost after dispatch counts at its worst case. An adult can see that in the call record (`uncertain`); there is no reconciliation screen yet.
- Status is self-reported by the host. A compromised host could misreport, but it still cannot exceed the limits, use another model or act for other players.
- Deleting a player removes its records and spend history; the audit events remain.
