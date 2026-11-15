# ADR 0052 — Model access for AI players: compatible endpoints, usable OpenRouter pricing, standing authority

Status: adopted 2026-11-15 for master plan step G2 (owner decision 9: any model, must work with OpenRouter and Kong AI Gateway). Builds on [ADR 0013](0013-provider-gateway-boundary.md) and [ADR 0051](0051-ai-player-harness.md).

## Context

Three things stood between the provider gateway and an AI player:

1. **No OpenAI-compatible connection.** Kong AI Gateway exposes an OpenAI-compatible chat endpoint; the gateway knew only OpenRouter and Ollama.
2. **OpenRouter models could not pass the price rule.** The router needs a price for all nine dimensions. OpenRouter's catalog gives input, output, request and image, so cache, reasoning, audio and tool were always unknown, and every OpenRouter model was ineligible. The adapter also refused any model that can reason, which today means most models.
3. **No authority for long-running work.** Model calls need an execution grant bound to an adult's live browser session for at most an hour. An AI player keeps playing after the owner closes the dashboard.

## Decision

1. **`openai_compatible` connections.** The instance operator declares each endpoint in the protected provider policy file: URL, chat path, credential header (`apikey` for Kong key-auth, `authorization` bearer, or `x-api-key`), `public` (HTTPS, public addresses only) or `private` (only listed LAN or Tailscale addresses), and its models with **all nine prices**, the price source and the date checked. Nothing is discovered from the endpoint. The organization's connection row only binds to that endpoint and holds the sealed credential, as for OpenRouter. The wire keeps one fixed path, pins the resolved address and never follows redirects.
2. **OpenRouter prices that cannot apply are zero, with reasons.** Cached and reasoning tokens are already counted inside OpenRouter's prompt and completion totals. CraftLayer never sends `cache_control`, images or audio. Every request disables plugins, so there is no web search, and tool calls are billed as tokens. These dimensions are therefore set to 0. A reasoning price above the output price counts only by the difference. Any other catalog field that is not exactly zero still makes the model ineligible. Models that can reason are allowed, with `reasoning: {effort: "low", exclude: true}`; their reasoning tokens are inside the completion count the ledger settles. A missing completion cap falls back to the context size, at most 8192.
3. **Standing authority.** `AuthService.guardStanding` checks the delegating adult's current standing without a session: the user must be an enabled adult, the membership enabled, and `ai_player:manage` (new, org admins) held in scope now. Every gateway step in `generateStanding` re-runs it, so demotion or suspension stops the player at its next call. The call may use exactly the model chosen in the player's profile (`connection_id` plus `model_id`), nothing else. The ledger records the adult as the user scope and the player's project as the project scope, so all existing hourly limits apply. `refreshStanding` renews the chosen connection's price snapshot for long sessions. `chosenModel` returns the snapshot for cost bounds.

## Consequences

- Strict free-only behaviour is unchanged: zero-valued OpenRouter dimensions are still not *enforced* free, so free-only policies refuse them as before (`zero_cost_not_enforced`).
- Settlement charges input tokens at input + cache prices and output tokens at output + reasoning prices. With the zero rule above it equals the real OpenRouter charge. For a compatible endpoint it overstates the spend if the operator enters non-zero cache prices, so the runbook says to enter 0 for features CraftLayer never uses.
- The operator keeps the compatible price table current. A stale table is the operator's error, not detected by CraftLayer. The source and date are stored with every price snapshot.
- Standing authority is a new path that bypasses session expiry by design. It is limited to the AI player service, to one model, and to the adult's live permissions and budgets. Its audit and per-player spending limit arrive with the AI player records (G3).
- Paid calls still need the instance policy's `allow_paid` and a non-zero cap, an organization or project policy allowing hosted and paid models, and hourly budgets that allow spend. The setup steps are in the [providers runbook](../../development/providers-and-budgets.md#openai-compatible-endpoints-kong-ai-gateway).
