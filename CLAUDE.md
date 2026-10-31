# Claude Code entry point

Read and follow [AGENTS.md](AGENTS.md), which is the canonical shared engineering instruction file. This file adds Claude Code navigation only; do not duplicate or weaken shared rules here.

## Required reading order

1. [Current state](docs/delivery/status.md).
2. [Documentation map](docs/README.md).
3. [Product requirements](docs/product/requirements.md).
4. The authorized [chapter](docs/delivery/roadmap.md) and its architecture references.
5. [Backlog](docs/delivery/backlog.md) and relevant [ADRs](docs/architecture/decisions/README.md).

Chapter 00 foundation is implemented; consult current status and review evidence before starting later work. At every build-step endpoint update the plan, commit, push to `origin main` and verify synchronization as required by AGENTS.md. Do not treat the source blueprint's embedded master prompt as authorization to implement Chapter 00 during a planning request.

## Default implementation workflow

When the user asks to start building without a different scope, execute Chapter 00, using task IDs `CL-00-01` onward. Explain any design deviation, implement tests alongside behavior, run the established checks, and prepare the chapter review. Stop at the chapter checkpoint unless the user authorizes further chapters. Existing authorization always takes precedence over this default.

For a continuation, read the handoff and status first. Verify which files and checks exist; do not regenerate completed work or invent test results. Use [the handoff template](docs/templates/agent-handoff.md) to leave a reproducible next action.

Claude Code-specific local settings are optional and must not become a runtime dependency. Do not store tokens or broad permission bypasses in committed configuration.
