# Chapter 02 — Provider gateway

**Status:** in progress; user authorized Chapter 02. **Implementation evidence:** [build log](../delivery/build-log.md).

**Milestone:** M1. **Requirements:** PR-004–007, PR-021; NFR-09.

## Objective

Provide OpenRouter/Ollama access through a fail-closed policy gateway with auditable usage and concurrent budget reservations.

## Dependencies and entry gate

Chapters 00–01 accepted for advancement. Auth, tenant scope and migration infrastructure exist. The recovery outbox supplies an encryption pattern; provider credential storage/key rotation is new work in CL-02-02, not an existing completed feature.

Before work: inspect Git status, read AGENTS.md and delivery status, confirm the authorized chapter scope, and inspect the previous review evidence. Do not assume a dependency is complete merely because its specification exists.

## Scope and implementation approach

Normalized model interfaces, catalogs/capabilities, encrypted server-side credentials, OpenRouter/Ollama transports, policy, cooldown, quota reservations and settlement. No guaranteed free hosted availability.

All runtime model calls go through model-router. Provider transports cannot choose budgets or credentials based on prompts. Ledger remains authoritative in PostgreSQL; Redis cooldowns are recoverable hints.

Architecture references: [model-routing](../architecture/model-routing.md), [data-model](../architecture/data-model.md), [security-and-access](../architecture/security-and-access.md).

## Ordered engineering tasks

Each task is initially unchecked. Dependencies below describe the default conservative order; record an explicit justified dependency change before reordering. Task sizes are relative engineering complexity (M/L), not delivery dates.

### [x] CL-02-01 — Provider and pricing contracts

**Depends on:** Chapter 01 gate. **Size:** M. **Status:** verified; see build log.

**Implementation:** Define request/result/error schemas, capabilities, price dimensions/units/provenance and freshness semantics. Add fake transport/clock fixtures and identify strict zero-cost enforcement support per path.

**Required evidence:** Malformed/unknown capabilities and price metadata are explicit; contract fixtures cover every normalized error.

### [ ] CL-02-02 — Credential and connection management

**Depends on:** CL-02-01. **Size:** L. **Status:** not started.

**Implementation:** Implement encrypted org-bound credentials, key references/rotation, endpoint validation and redacted admin routes. Keep secret decryption inside trusted server/worker paths.

**Required evidence:** Secret canary is absent from browser/client/events/logs; wrong-org decrypt and forbidden endpoints deny.

### [ ] CL-02-03 — Ollama adapter

**Depends on:** CL-02-02. **Size:** M. **Status:** not started.

**Implementation:** Implement bounded discovery/generation/cancel/timeout and explicit operator-owned local endpoint trust. Distinguish infrastructure cost from provider price and do not accept arbitrary local-network URLs.

**Required evidence:** Mocked contract suite passes; optional local smoke records exact model and hardware without requiring cloud.

### [ ] CL-02-04 — OpenRouter adapter

**Depends on:** CL-02-03. **Size:** L. **Status:** not started.

**Implementation:** Implement catalog fetch, pricing/capability normalization, configured free entries, explicit routing controls and accounted retries. Never rely on a model suffix alone or send unvetted fallback arrays.

**Required evidence:** Synthetic paid fallback, missing dimensions, upstream 429/auth/timeout and stale catalog cases behave safely.

### [ ] CL-02-05 — Policy and cooldown router

**Depends on:** CL-02-04. **Size:** L. **Status:** not started.

**Implementation:** Intersect scope policies and capabilities, validate fresh eligible candidates, reserve before dispatch, add bounded cooldown/backoff and explanatory block reasons. Revalidate before every fallback.

**Required evidence:** Zero calls reach paid/ineligible endpoints; 429 falls back only to eligible local/free paths; no candidate blocks.

### [ ] CL-02-06 — Budget ledger and reconciliation

**Depends on:** CL-02-05. **Size:** L. **Status:** not started.

**Implementation:** Add stable-order multi-scope reservations, integer monetary math, request idempotency, observed/estimated usage settlement and conservative uncertain holds. Prevent hidden SDK retry amplification.

**Required evidence:** Concurrent reservations stay within caps; repeated settlement and timeout-after-dispatch do not undercount.

### [ ] CL-02-07 — Gateway review and operator docs

**Depends on:** CL-02-06. **Size:** M. **Status:** not started.

**Implementation:** Publish config/policy examples, secret rotation and quota exhaustion guidance. Run all fake-provider failure suites and separately label any authorized live smoke.

**Required evidence:** Default configuration has zero allowed paid spend and no required provider key; evidence records all unverified external assumptions.

## Test plan

- Unknown, stale, incomplete, negative, overflow and nonzero pricing denies free-only.
- 429 cooldown, eligible fallback, all providers down, invalid key and disabled connection.
- Concurrent org/user/mission reservations, duplicate callback, crash and stream interruption.
- Credential rotation/revocation or policy tightening between reservation and dispatch.

Use deterministic/fake services first. Any live inference, public deployment, publication or payment action needs existing user authorization for that action; local tests must not silently use real keys. Record exact commands, versions, fixture seeds and exit results. An unavailable dependency is unverified/blocked, not passed.

## Security considerations

- Paid providers disabled by default; no actual paid calls for acceptance.
- Catalog metadata is not a guarantee against upstream billing changes; strict paths require enforceable bounds.
- Do not expose API keys in queues, prompt context or exported configs.

## Acceptance criteria

- [ ] Both adapter contracts pass offline; authorized local smoke is recorded separately.
- [ ] Policy adversaries result in zero paid dispatches and meaningful blocked status.
- [ ] Usage is auditable, bounded and correctly distinguishes unknown from zero.
- [ ] Required tests pass, relevant documentation is updated, and no unreviewed safety regression remains.
- [ ] Every completed task points to concrete evidence; deferred checks are explicitly listed with impact.

## Demonstration and independent verification

Use fake OpenRouter to trigger 429, fall back to local/fake Ollama, then show paid/stale choices blocked and ledger reservations settled.

## Documentation and deliverables

Provider schemas/adapters; encryption/key runbook; policy samples; ledger migrations; contract tests; chapter review.

Update the OpenAPI/SDK or configuration reference when changed, add migrations/compatibility notes, and capture limitations. Use a dedicated chapter review document based on [the review template](../templates/chapter-review.md). Do not edit the original source blueprint.

## Review checkpoint and next handoff

Fill the chapter review with implementation summary, task/requirement mapping, checks, security evidence, benchmark results where relevant, known issues and next steps. Update [status](../delivery/status.md), [backlog](../delivery/backlog.md) and [decisions](../delivery/risks-and-decisions.md) together. A chapter is accepted only when its acceptance evidence is reviewed.

Complete the authorized scope before asking for the next chapter. Default chapter-by-chapter authorization follows the blueprint; an explicit user instruction authorizing multiple chapters overrides that default. Use [the handoff template](../templates/agent-handoff.md) so the next session can resume without reconstructing context.
