# CraftLayer engineering instructions

These instructions apply to the whole repository and are shared by Codex and Claude Code. A direct user instruction takes precedence. Read this file before changing code or plans.

## Current state and source of truth

- Chapters 00–01 are implemented and verified. Read the Chapter 01 review and current status before choosing later work. The user authorized Chapter 02 by requesting the next steps; Chapter 03 still requires authorization.
- Read `docs/delivery/status.md`, `docs/README.md`, the relevant chapter, and its architecture references before starting work.
- Product invariants live in `docs/product/requirements.md`; detailed contracts live in `docs/architecture/`; implementation order lives in `docs/delivery/backlog.md`.
- Preserve `docs/source/CraftLayer_Build_Blueprint.md` as the original input. Amend derived plans and record deviations in an ADR.
- If documents conflict, do not silently pick a convenient interpretation. Prefer the stricter safety invariant and record the conflict in the decision register. Update related documents together.

## Scope and autonomy

- A request to plan does not authorize building the application. For a new implementation request without a chapter number, default to Chapter 00 only.
- Work through authorized tasks in order. Do not stop between routine edits, reversible local operations, or required tests within an authorized chapter.
- At a chapter boundary, provide the review evidence and request authorization for the next chapter, following the blueprint's chapter checkpoint. Explicit authorization for multiple chapters supersedes this default.
- Never mark unexecuted checks as passed. Distinguish implemented, verified, deferred, and blocked work.
- Do not create Cloud implementation in this Core repository. Chapter 11 is separately authorized work in a separate repository.
- Do not run paid inference, purchase services, deploy publicly, publish packages, or send messages unless separately authorized. Normal implementation tests use local fakes. The user has explicitly authorized ongoing commits and pushes to `main` for build steps.

## Invariants to preserve

1. Core is fully useful without Cloud, telemetry, internet entitlement checks, or hosted identity.
2. Derive organization context from authenticated membership. Never trust an organization ID supplied in a request body or queue message alone.
3. Enforce permissions in API handlers, runtime services, and workers; UI restrictions are supplementary.
4. Deny paid fallback by default. Unknown/stale price information is ineligible under free-only policy. Configuration cannot bypass instance-level constraints.
5. PostgreSQL owns durable state. Queue delivery is at least once. Leases, fencing, reconciliation, idempotency, and an outbox are required for reliable effects.
6. LLM output is untrusted structured input. Agents cannot grant permissions, approve themselves, choose arbitrary tools, or alter their own budgets.
7. Emergency stop persists and takes priority over scheduling, retries, approvals, and reconnects. Never auto-clear it on restart.
8. Child accounts use adult-approved Minecraft presets and assigned worlds/agents only. No arbitrary prompts, terminal, coding, provider keys, player attacks, or external tools.
9. Never expose credentials to browser bundles, logs, agent prompts, queue payloads, or artifacts. Never mount the Docker socket into API/web/general agent containers.
10. Never promise exactly-once physical effects or guaranteed free hosted capacity.

## Implementation conventions

- TypeScript strict mode, pnpm workspace, explicit dependency graph, Zod request/event/tool schemas, Fastify API, Next.js web, Drizzle/PostgreSQL, BullMQ/Redis, Pino logs. Exact supported versions are selected and pinned in Chapter 00.
- Keep domain logic independent of Fastify, Next.js, BullMQ, and individual provider SDKs. Use public interfaces across packages.
- Share JSON-safe contracts; never import server secrets, database clients, or Node-only adapters into the dashboard.
- Use parameterized queries, scoped repositories, tenant-aware foreign keys, transaction-local RLS context, and a separate migration role.
- Persist schema migrations and meaningful test fixtures. Avoid migration-time external network calls.
- Use deterministic clocks, seeded Minecraft fixtures, fake providers, fake adapters, and fault injection where possible.
- Keep changes focused. Do not refactor unrelated code or add frameworks without an ADR explaining the need.
- Consult official documentation for the pinned version before implementing provider SDK or framework specifics. Do not invent currently available free models or hardcode prices from this plan.

## Mandatory build-step publication

At the end of **every build step** (a numbered task or a documented smaller coherent checkpoint): run the relevant checks; update chapter/backlog/status and the build log with the exact stopping point, evidence and next action; commit the task-related changes; push to `origin main`; then verify that local HEAD and remote `main` match and the working tree is clean. This is a standing user requirement, not a new permission request. Never force-push or include secrets. A failed check or failed push must be reported honestly and recorded; do not claim an unverified step is complete. Preserve unrelated user changes.

## Verification and handoff

Root scripts are introduced incrementally during Chapter 00; inspect package.json for current availability. Chapter 00 establishes `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm docs:check`, and Compose validation. Run only commands that actually exist; add required scripts in the foundation.

For each task: record its ID, implement the smallest coherent slice, run relevant checks, attach evidence, and update the backlog/status. A task may use shared chapter evidence, but must identify which acceptance criteria it covers.

For each chapter: complete `docs/templates/chapter-review.md`, update the risk register and status, report files changed and exact command results, and include any unverified manual steps. Do not replace acceptance evidence with a confident narrative.

Use `docs/templates/agent-handoff.md` when handing work to another session or agent. Preserve user changes; inspect Git status before editing. Commit only task-related files. Never include `.env`, credentials, worlds, database dumps, or generated private research artifacts.
