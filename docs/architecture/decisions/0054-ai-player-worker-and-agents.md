# ADR 0054 — The AI player worker, its brain, and AI agents that instruct it

Status: adopted 2026-11-15 for master plan steps G4–G8. Builds on [ADR 0051](0051-ai-player-harness.md), [0052](0052-ai-player-model-access.md) and [0053](0053-ai-player-records-and-hosts.md). Amends the agent-token allowlist of [ADR 0035](0035-agent-token-authority.md) by one named exception.

## Decision

1. **Worker host process.** `apps/ai-player` (`node apps/ai-player/dist/main.js`) reads one host token from a file that only its owner can read. It polls its assignments every two seconds and runs one controller per AI player that should run. It holds no provider keys, no database access and no server-control rights. If the API cannot be reached for 20 seconds, it stops every player. Stop takes effect on the next poll.
2. **Body.** One Mineflayer session per player with the G1 fixes (tick-end rule, server hitbox width, correction guard). A player with Microsoft sign-in runs the device-code flow on the worker host. The code is reported to the owner's screen, and the token cache lives only in the worker's protected state directory (`microsoft/<player>`, mode 0700), never in CraftLayer. When the server reports a duplicate login (the owner joined with the same account), the worker leaves and does not reconnect until an adult's Start changes the assignment version. Other disconnects back off at 5 s, 15 s, 30 s, 60 s, then 120 s.
3. **Three layers.**
   - **Reflexes** need no model: eat when food is at 14 or below; strike back at a hostile mob when hurt and idle.
   - **Skills** are the only game effects. There are 15 typed, validated, interruptible actions with plain-language results: look, walk, follow, come to a player, mine, recipe look-up, craft (placing a crafting table when needed), place a block, store in or take from a chest, eat, fight hostile mobs only, say, remember, and finish. None sends commands, and there is no free-form game action.
   - **The brain** asks the model for one turn at a time.
4. **The brain's turn.** Each turn sends a system message (persona, owner's rules, behaviour rules, the Minecraft know-how pack) and one context message:
   - the owner's in-game names and whether they are online;
   - the current goal and its source;
   - the 12 most relevant memories (owner notes first, then word overlap, recency and kind);
   - the allowed master tasks, when idle;
   - the surroundings (blocks with coordinates, creatures, inventory);
   - the last 16 events, and the trigger for this turn.

   At most three tool calls run per turn, and a goal gets at most 12 turns. An unknown tool or invalid arguments are fed back; the third confusion ends the goal with a question to the owner. A new instruction aborts the running skill and replaces the goal. The model's text goes to the owner where they spoke: in game it is said through the chat filter. With no instruction, the highest-priority master task whose condition holds runs, then cools down for five minutes, with at least 30 seconds between idle turns. With no applicable task the brain makes no model calls. Refusals: out of budget pauses thinking for ten minutes and tells the owner once; stopped or revoked standing stops the player; rate limited keeps the goal and waits a minute.
5. **Chat.** The owner is recognised by in-game name, Java UUID or Bedrock XUID (Floodgate's derived UUID). On an online-mode server the name is authenticated, so it is the simple default. An owner's message is an instruction only when it starts with the player's name or is a whisper. Everyone else's chat, and any text in signs or books, is never an instruction. Outgoing chat is one line of at most 220 characters, with control characters removed and a small block list applied. A leading `/` or `\` is stripped, so the model can never issue a server command through chat.
6. **AI agents (MCP) may instruct.** A new agent-token permission, `ai_player:instruct`, allows `list_ai_players`, `get_ai_player_conversation`, `instruct_ai_player` and `stop_ai_player`, through `/api/v1/agent/ai-players…`. It is the **only** non-read permission an agent token can carry, and the allowlist test names it. It cannot start a player, clear a stop, change settings or limits, or reach worker routes. Instructions are recorded as `<adult> (via AI agent)` on the `mcp` channel. A stop latches exactly like an adult's. As with every agent permission, the token never exceeds the adult who created it.

## Consequences

- Model quality decides how well a player plays. The harness keeps the model's job small (pick a skill and its arguments) and reports each step, so a weak model fails visibly rather than doing something unsafe.
- Reflexes and status reports run without the model and cost nothing. Thinking happens only for instructions, follow-up turns and master tasks.
- The Microsoft session lives on the worker host. Losing that machine means revoking the session at Microsoft; a dedicated account limits the exposure (owner decision 8).
- Instructing an AI player is a bounded action: it spends within the player's limits and acts only through the skills. That is why it is allowed to agents while every server-changing action still needs an adult's approval.
