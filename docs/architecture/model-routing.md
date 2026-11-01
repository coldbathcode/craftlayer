# Model routing, budgets and usage accounting

Status: Chapter 02 provider slice implemented; runtime/CPU/storage budgets and canonical mission/task policy integration remain Chapter 03 onward. See [operator runbook](../development/providers-and-budgets.md) and [ADR 0013](decisions/0013-provider-gateway-boundary.md). No live inference is required for synthetic acceptance.

## Normalized contract

`ModelProvider` exposes model discovery, capability metadata and cancellable generation. `GenerateRequest` includes request ID, prompt/messages, validated tool schemas, input/output bounds, timeout and abort signal. The router supplies organization/mission/task policy context internally; untrusted prompts cannot choose credential IDs or endpoints.

`ModelDescriptor` includes canonical/provider model IDs, model family, context/output limits, supported modalities/tool/structured-output capabilities, endpoint identity, pricing dimensions/currency/unit, snapshot provenance and expiry. Missing usage or capability metadata is explicit, never silently zero/true.

Normalize results to text/structured tool proposals, finish reason, usage with `observed/estimated/unknown` quality, provider request ID, latency and redacted metadata. Normalize errors: rate limited, auth, unavailable, malformed response, context exceeded, timeout, aborted and policy denied.

## Eligibility algorithm

1. Load current installation/org/project/mission policies and verify principal, grant and stop state.
2. Intersect configured endpoint/model allowlists, requested capabilities, privacy restrictions and context limits.
3. For hosted inference in free-only mode, require fresh pricing evidence for all relevant dimensions. Reject nonzero prompt/output/cache/request/tool/image/audio/reasoning charges, unknown dimensions, unsupported currencies and optional paid features.
4. Reject paid fallback unless explicitly permitted by every governing policy and an approved nonzero budget exists. Default is `free_only=true`, `allow_paid_fallback=false`, `max_paid_spend_usd=0`.
5. Confirm request/output caps and calculate conservative maximum reservation for applicable token/request/spend limits. Reserve atomically before dispatch.
6. Choose deterministic priority among eligible non-cooldown candidates. On 429, record cooldown and consider only another eligible candidate. No eligible candidate → block/queue with reason and bounded retry schedule.
7. Revalidate snapshot/policy/stop epochs immediately before network dispatch. Each fallback is a separate attempt/reservation and trace entry.

OpenRouter free variants have separate catalog entries, and fallback models can incur their own charges. CraftLayer therefore controls its fallback list and disables unverified provider-side rerouting under strict free-only policy. A `:free` suffix alone is insufficient evidence. [OpenRouter free variants](https://openrouter.ai/docs/guides/routing/model-variants/free).

Discovery uses provider metadata rather than permanent hardcoded “free model” lists. For OpenRouter, inspect the official models endpoint and supported pricing fields during implementation. [Model catalog reference](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties).

## Pricing freshness and limits of assurance

Implemented hosted-pricing maximum TTL: 5 minutes, with refresh on policy changes or relevant errors. Stale cache denies hosted dispatch. Use decimal parsing with explicit currency/unit conversion; never floating-point monetary arithmetic. Store source hash and observation time with the decision.

Checking metadata cannot provide an absolute guarantee against an upstream price change or misleading endpoint. Strict free-only support requires documented provider-side zero-cost enforcement or an endpoint whose billing behavior can be bounded and tested. Otherwise classify that adapter/model path as ineligible for strict hosted free-only. The UI must state this boundary. Local Ollama is a separately classified operator-owned inference path with zero provider invoice estimate; CPU/electricity costs remain.

Compatible endpoints are not automatically trusted to report zero price. Instance admins must declare trust policy and endpoint classification; org admins cannot relabel a paid hosted service as local. Disable arbitrary provider-side plugins, server tools, auto model routing and paid feature flags unless explicitly modeled and bounded.

## Budget hierarchy

Instance ceiling → organization → user → project → mission → task. Units: provider spend in integer micro-USD, input/output/total tokens, calls, tool calls, elapsed execution time, concurrent agents/missions, CPU/runtime and retained bytes. User budgets prevent a single user exhausting the org; organization budgets remain authoritative regardless of user limits.

Acquire all relevant budget windows in a stable order. Reservation plus active counters must fit every remaining limit; otherwise roll back the whole request. Provider concurrency/rate limits are separate from monetary limits. Reserve for worst-case input/output and bounded ancillary charges, not a model's optimistic estimate.

Ledger states: `reserved` → `dispatched` → `settled` or `uncertain`; `released` only if non-dispatch or known actual usage permits it. Retries/fallbacks count separately. An interrupted dispatched call retains a conservative hold until reconciliation. Do not reclaim uncertain spend merely because a worker lease expired. Every settlement uses a durable reservation identity and receipt hash to prevent double accounting.

Enforce immutable ledger entries with compensating adjustments, not silent edits. Reports show observed versus estimated usage and outstanding reservations. A zero-paid-spend policy still has token, request and CPU limits to prevent denial of service.

## Credentials and endpoint security

Credential setup is an adult administrative operation. Browser may submit a secret over authenticated encrypted transport once, then receives redacted metadata only. Encrypt stored values with authenticated encryption, organization-bound associated data and key versioning. Master key lives outside DB and images; keys are absent from agent/sandbox context and queue payloads.

Endpoint configuration validates scheme, host, port, DNS and redirects. Local endpoints require an explicit installation allowlist. Disable remote HTTP by default; document trusted local Docker-network exceptions. Apply response size, connection and overall deadlines. Rebinding protections and outbound proxy controls cover research and hosted endpoints according to distinct policy.

## Test matrix

- Unknown/stale/malformed/negative/nonzero price, omitted dimension, overflow and unsupported currency all deny strict free-only.
- Paid model hidden in a fallback array never receives a call.
- 429 produces cooldown; eligible free/local fallback succeeds; exhaustion blocks.
- Simultaneous reservations across scopes cannot exceed caps.
- Stream interruption, timeout after dispatch, duplicate usage callback and worker crash do not undercount or double-settle.
- Policy/credential revocation between planning and dispatch prevents the call.
- Provider SDK retries are disabled or explicitly bounded/accounted; hidden retries cannot multiply usage.
- Credentials and raw sensitive prompts are absent from logs/events/browser bundles.
