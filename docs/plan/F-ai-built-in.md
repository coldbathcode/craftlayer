# Milestone F — AI built in

Part of the [master plan](../MASTER_PLAN.md). Status lives on the [status board](STATUS.md).

## Goal

AI helps the family in two ways: an assistant in the dashboard that manages servers by conversation, and AI helpers inside the game that play alongside the children under adult-approved rules.

## F1 — Dashboard assistant

- "Ask CraftLayer" panel for adults: "Who played this week?", "Let George in", "Back up before we update".
- Uses the same tools and approval flow as [Milestone C](C-ai-agent-access.md), acting with the signed-in adult's permissions. Proposed changes appear as buttons the adult taps; the assistant's text never performs an action by itself.
- Runs through the existing provider gateway (Chapter 02): free-only by default, with budgets and emergency stop. Paid models only if the owner turns them on.
- Not available to child accounts.
- **Done when:** the five B4 usability tasks can also be done by conversation, with every change confirmed by a tap and audited.

## F2 — AI helpers in the game

This is the original CraftLayer vision ([Chapter 04](../chapters/04-minecraft-adapter.md), [05](../chapters/05-dashboard-and-kid-mode.md), [06](../chapters/06-cooperative-armies.md)), now built on the live, managed server instead of fixtures.

- **F2a — One helper bot** joins a chosen world as an allowlisted bot account, follows a child, gathers or builds from approved presets, and stops instantly on Stop All. Uses the completed fleet runtime (Chapter 03).
- **F2b — Kid Mode.** Children pick world → helper → preset → Start. No free-text prompts, no admin.
- **F2c — Teams.** Several helpers cooperate (for example, build a shelter together).
- Bots run in their own worker processes with their own credentials, separate from the server helper (ADR 0016). They never get RCON, Docker or admin rights.
- **Needs separate authorization:** Chapter 04 remains gated until the owner approves it. Bot accounts may need extra Minecraft licences — owner decision.
- **Done when:** a child launches a helper in three taps, it completes a preset in the real world, and Stop All halts it within seconds.
