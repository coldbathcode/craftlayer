# Chapter 07 — Additional providers

**Status:** not started. **Specification:** ready for engineering review. **Implementation evidence:** none.

**Milestone:** M3. **Requirements:** PR-004–007, PR-014, PR-022.

## Objective

Add Gemini, OpenAI, Anthropic and compatible endpoints without weakening shared pricing, privacy, capability or usage controls.

## Dependencies and entry gate

Chapters 00–06 accepted by default; provider work technically depends on 02–03 and must not bypass the authorized chapter sequence.

Before work: inspect Git status, read AGENTS.md and delivery status, confirm the authorized chapter scope, and inspect the previous review evidence. Do not assume a dependency is complete merely because its specification exists.

## Scope and implementation approach

Optional disabled-by-default adapters, common transport/stream normalization, updated catalog contracts, compatibility documentation and provider-specific terms/metadata review.

Reuse router/ledger/credential contracts. Provider-specific features are declared capabilities; unsupported tools/structured output/pricing paths reject explicitly rather than being emulated invisibly.

Architecture references: [model-routing](../architecture/model-routing.md), [api-and-events](../architecture/api-and-events.md), [security-and-access](../architecture/security-and-access.md).

## Ordered engineering tasks

Each task is initially unchecked. Dependencies below describe the default conservative order; record an explicit justified dependency change before reordering. Task sizes are relative engineering complexity (M/L), not delivery dates.

### [ ] CL-07-01 — Provider capability and terms matrix

**Depends on:** Chapter 06 gate. **Size:** M. **Status:** not started.

**Implementation:** Review official APIs/SDKs, usage/pricing dimensions, retry defaults, cancellation and data handling for each provider. Record whether strict free-only is supportable per path; no resale assumptions.

**Required evidence:** A dated matrix distinguishes tested behavior, metadata gaps and disabled capabilities.

### [ ] CL-07-02 — Gemini adapter

**Depends on:** CL-07-01. **Size:** L. **Status:** not started.

**Implementation:** Implement normalized discovery/configured catalog, generation, structured proposal support where verified, errors and observed/estimated usage. Leave enabled=false in defaults.

**Required evidence:** Synthetic common contract suite passes; account-level free allowances alone never bypass strict price policy.

### [ ] CL-07-03 — OpenAI adapter

**Depends on:** CL-07-02. **Size:** L. **Status:** not started.

**Implementation:** Implement verified current API transport behind normalized contract, bounded retries/cancellation and usage/tool capability mapping. Avoid SDK types leaking into core.

**Required evidence:** Contracts cover output limits, error/stream interruption and usage uncertainty without any live paid calls.

### [ ] CL-07-04 — Anthropic adapter

**Depends on:** CL-07-03. **Size:** L. **Status:** not started.

**Implementation:** Implement verified transport, content/tool/usage normalization, context limits and refusal/error handling. Record unavailable price/capability dimensions explicitly.

**Required evidence:** Common contract suite and provider-specific malformed/refusal/error fixtures pass.

### [ ] CL-07-05 — Compatible-endpoint adapter

**Depends on:** CL-07-04. **Size:** L. **Status:** not started.

**Implementation:** Validate explicit endpoint trust, declared capability subset, price provenance and schema differences. Do not assume full compatibility or zero cost from a successful response.

**Required evidence:** Partial/lying/incomplete endpoints fail safely; forbidden local/metadata/private URLs deny per policy.

### [ ] CL-07-06 — Provider policy parity and usage review

**Depends on:** CL-07-05. **Size:** L. **Status:** not started.

**Implementation:** Apply shared free-only, privacy, reservation, settlement, cooldown and key rotation tests across all adapters. Account for cached/reasoning/server-tool dimensions where supported.

**Required evidence:** No adapter bypasses routing or ledger; missing cost bounds disable relevant paths; all paid providers remain off.

### [ ] CL-07-07 — Extension documentation and review

**Depends on:** CL-07-06. **Size:** M. **Status:** not started.

**Implementation:** Publish adapter author guide, capability matrix, config samples and opt-in live smoke instructions with explicit cost authorization. Add third-party adapter fixture built against public contracts.

**Required evidence:** A minimal test adapter integrates without importing scheduler internals; no credentials required by CI.

## Test plan

- Common adapter test suite including cancellation, malformed response, auth, 429 and timeout.
- Unknown usage, cached/reasoning/server-tool charges, hidden retry and stale catalog.
- Free-only parity across all concrete and compatible transports.
- Key rotation, endpoint redirects and forbidden-network targeting.

Use deterministic/fake services first. Any live inference, public deployment, publication or payment action needs existing user authorization for that action; local tests must not silently use real keys. Record exact commands, versions, fixture seeds and exit results. An unavailable dependency is unverified/blocked, not passed.

## Security considerations

- No automatic enablement or live paid smoke.
- Provider API access does not imply permission for token resale.
- Endpoint trust and model data-retention settings are administrator policy, not model choices.

## Acceptance criteria

- [ ] All four new adapters pass common offline contracts and capability-specific tests.
- [ ] Disabled-by-default behavior and free-only enforcement are unchanged.
- [ ] Official version/terms references and unsupported paths are clearly recorded.
- [ ] Required tests pass, relevant documentation is updated, and no unreviewed safety regression remains.
- [ ] Every completed task points to concrete evidence; deferred checks are explicitly listed with impact.

## Demonstration and independent verification

Select each fake adapter through the same router, show normalized result/error/usage, and prove nonzero/unknown-priced requests are denied.

## Documentation and deliverables

Adapters; provider compatibility matrix; contract fixtures; author guide; updated config/docs; chapter review.

Update the OpenAPI/SDK or configuration reference when changed, add migrations/compatibility notes, and capture limitations. Use a dedicated chapter review document based on [the review template](../templates/chapter-review.md). Do not edit the original source blueprint.

## Review checkpoint and next handoff

Fill the chapter review with implementation summary, task/requirement mapping, checks, security evidence, benchmark results where relevant, known issues and next steps. Update [status](../delivery/status.md), [backlog](../delivery/backlog.md) and [decisions](../delivery/risks-and-decisions.md) together. A chapter is accepted only when its acceptance evidence is reviewed.

Complete the authorized scope before asking for the next chapter. Default chapter-by-chapter authorization follows the blueprint; an explicit user instruction authorizing multiple chapters overrides that default. Use [the handoff template](../templates/agent-handoff.md) so the next session can resume without reconstructing context.
