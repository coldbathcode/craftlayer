# ADR 0051 — AI player harness: a named, model-agnostic, budgeted player placed next in the plan

Status: proposed on 2026-11-15 at the owner's request ("add it as the next thing to do"). Planning only: implementation starts when the owner completes step G0 (accepts the Chapter 03 review and authorizes Milestone G). Plan: [Milestone G](../../plan/G-ai-player.md).

## Context

The owner wants an AI agent that plays in the family world as a named player, takes plain-language instructions, remembers, reasons about the game, runs on any model (main foundation-model providers, OpenRouter or a local Ollama), and stops spending at a set limit. The existing plan reaches in-game agents only at F2, after F1 and Chapter 04 authorization. The older roadmap also places them after the F3 operations phase, and places direct foundation-model adapters at Chapter 07, after the bot chapters.

What exists: the provider gateway with OpenRouter and Ollama adapters, encrypted credentials, a fail-closed router and a reservation ledger in micro-USD with mission/task scopes (Chapter 02). The fleet runtime with durable stop latches, leases and fencing (Chapter 03, review awaiting owner acceptance). Agent tokens and MCP with approval-gated actions (Milestone C). A live server helper with adult-approved allowlist actions (Milestone A). The Chapter 04 specification for a bounded Mineflayer adapter.

## Decision

1. **Order.** Milestone G is the next build milestone in the master plan (ADR 0034 makes the master plan authoritative for order). It carries Chapter 04's tasks (CL-04-01 to CL-04-07) and moves the Anthropic, OpenAI and Gemini adapters forward from Chapter 07. The F3 gate in the older roadmap does not apply to G: G uses no provisioning or lifecycle capability, and the bot never gets server-control rights. The owner's G0 authorization is the Chapter 04 authorization.
2. **Three layers.** Deterministic reflexes and a typed skill library carry out every game effect; the model only chooses skills and arguments through validated tool calls. No raw commands, chat-to-command paths or operator rights.
3. **One gateway for every model.** All calls go through the existing router and ledger. New direct adapters implement the same normalized contract. Models without tool calling are not offered. Prices come from a provider catalog or an adult-maintained price table with source and date; unknown price means not selectable for paid use.
4. **Per-player budgets.** The ledger gains an AI-player scope with daily and total windows for spend, tokens and calls. The scope is reserved before each call, so concurrent calls cannot overshoot. At the limit the brain stops; reflexes keep the body safe; only an adult raises the limit.
5. **Its own process and account.** A player worker app hosts bot sessions, separate from the server helper (ADR 0016), with no RCON, Docker or node credentials. Each AI player signs in with its own Minecraft Java account through Microsoft's device-code flow; the session is stored encrypted and never enters prompts. Online sign-in and the allowlist stay on.
6. **Memory in PostgreSQL.** Working, episodic and fact memory per AI player and world, bounded and adult-editable. No new vector store; embeddings may later use a local Ollama model behind a separate decision.
7. **Instruction sources.** Dashboard chat, MCP (existing agent tokens) and in-game chat from configured trusted names. Children's chat is untrusted; children's instruction is limited to preset phrases an adult enables (AGENTS rule 8).

## Consequences

- Chapter 04's specification stays the engineering source for the bot adapter; Milestone G adds the brain, memory, model choice, conversation and cost monitor around it.
- Chapter 07 shrinks to the providers and compatible endpoints not delivered by G2.
- Each AI player costs a Minecraft licence. A turnkey multi-bot experience is not promised.
- Mineflayer support for the family server's game version is unverified. If none exists, the fallback (a protocol-translation plugin on the server) is a production change needing separate approval and a verified backup.
- Real-model evaluation and any paid call need the owner's paid-inference permission (decision 3 allows paid models; G0 sets the first limit). CI uses a scripted fake model and a fake body.
- Kid Mode (F2b) and teams (F2c) build on G's profiles, skills and limits rather than a separate stack.
