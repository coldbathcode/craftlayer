# Chapter 02 review — Provider gateway

**Implementation state:** implemented and locally verified. **Acceptance decision:** pending owner review. **Reviewer:** Codex implementation self-review; independent reviewer unassigned. **Date:** 2026-11-01 UTC. **Commit/tree:** task commits `5579818`, `d2ed473`, `bc1fca9`, `4975f2c`, `94c78b8`, `58ff780`, then the CL-02-07 review commit containing this file. **Authorized scope:** the user's “keep going next steps” after Chapter 01 authorized Chapter 02; Chapter 03 requires authorization.

## Delivered behavior

Core now has a server-only provider gateway, strict JSON-safe contracts, encrypted organization-bound credentials, protected operator endpoint/key policy, bounded Ollama/OpenRouter adapters, fresh eligibility and cooldown checks, persistent provider stop and durable hierarchical reservations/settlement. Adult administration routes expose redacted connections, catalogs, policies, budgets and usage. No public prompt-generation route or agent execution exists. The account console remains the identity interface; provider dashboard work is Chapter 05.

PR-004–007/PR-021 and NFR-09 are covered for the provider boundary. This does not claim complete runtime/child-preset flows or invoice accuracy. [ADR 0013](../architecture/decisions/0013-provider-gateway-boundary.md) records deviations and conservative enforcement; [the runbook](../development/providers-and-budgets.md) covers optional setup, key rotation, quotas and uncertain recovery. Changed-file inventory: `git diff --stat 067e1b1..HEAD`.

## Acceptance evidence

Commands run from repository root. All model responses, credentials and provider prices used by tests are synthetic. Real provider accounts and catalog endpoints were not contacted.

| Task / requirement | Exact command or procedure | Result / exit | Coverage |
| --- | --- | --- | --- |
| CL-02-01 / strict schemas and pricing | `pnpm check` | PASS / 0; 188 cases | 188 unit cases including malformed/unknown/negative/overflow pricing, unsupported dimensions/capabilities, decimal ceilings and normalized errors |
| CL-02-02 / credential isolation | `pnpm test:db` | PASS / 0 | Encrypted row-bound storage, wrong-org/version/key/tamper denial, rotation/revocation, redacted API projections and least-privileged roles |
| CL-02-03 / local protocol and endpoint trust | `pnpm check` | PASS / 0 | Fake Ollama tags/show/chat, GGUF/cloud checks, context/think controls, cancellation, unknown usage; native loopback HTTP tests pin DNS and reject redirects, oversize bodies and denied dispatch barriers |
| CL-02-04 / hosted safety | `pnpm check` | PASS / 0 | Fake OpenRouter catalog/chat, single-model routing, stale/missing ancillary prices, malformed/auth/429/timeout and key echo; no real strict-free enforcement manufactured |
| CL-02-05 / policy/stop/cooldown | `pnpm check`; `pnpm test:db` | PASS / 0 | Synthetic hosted 429 falls back to eligible local only; zero ineligible calls; cooldown survives service restart, authority/policy/credential tightening before dispatch denies |
| CL-02-06 / concurrent durable accounting | `pnpm test:db` | PASS / 0; 58 cases plus migration negatives | Scope/instance cross-org caps, integer monetary rounding, replay, duplicate and larger receipts, immutable ledger, unknown usage, revocation settlement, hourly rollover, crash-like reserved/dispatched recovery and forced RLS |
| CL-02-07 / protected operator deployment | `pnpm test:provider-stack` | PASS / 0 | Disposable real Compose/API rotation, mode/owner checks, revocation, stop restart, no key in responses/logs; zero inference/catalog calls |
| Local operation without external network | `pnpm test:offline` | PASS / 0; 188 cases | Non-root, read-only network-disabled unit suite |
| Production builds | `pnpm build`; `pnpm stack:up` | PASS / 0 | All strict projects/Next standalone; real migration/application readiness |
| Deployment and browser regression | `pnpm compose:check`; `pnpm check:stack`; `pnpm test:e2e`; `pnpm test:identity-ui` | PASS / 0 | Default secret separation, loopback ports, unclaimed main owner; four desktop/mobile regressions pass with two identity-only skips, plus one separate full identity journey |
| Secret/input/document preservation | `node scripts/check-local-secrets.mjs`; `pnpm docs:check`; `git diff --check` | PASS / 0 | Values compared in memory against source/public JS; source blueprint unchanged; links/task structure |

Environment: macOS arm64; Node 22.23.3 / pnpm 10.23.0; TypeScript 5.9.3; Fastify 5.12.7 / Zod 4.6.7 / Drizzle 0.45.4 / pg 8.23.1; Next 16.4.3 / React 19.3.1; Vitest 5.0.5; Playwright Chromium 1.64.1. Pinned PostgreSQL image reports 18.6 and Redis 8.10.3. Full dependency/image pins and host details are in the compatibility matrix. No new provider SDK or hidden retry library was added.

Hosted CI: CL-02-06 passed [run 41290808138](https://github.com/coldbathcode/craftlayer/actions/runs/41290808138); task CL-02-05 passed [run 41287947350](https://github.com/coldbathcode/craftlayer/actions/runs/41287947350). The final publication receives a fresh full pipeline; inspect that commit's checks for final hosted qualification.

The initial optional-mount smoke exposed host/VM bind-file propagation races: immediate post-rename reads could deny with missing-file errors, and an immediate chmod check could observe old metadata. The fixture now allows bounded propagation after protected edits before assertions; it does not weaken mode/owner or credential checks. The read-only directory mount makes atomic replacement visible, and operators keep the persistent organization stop latched throughout rotation until verification. The successful rerun covers both rewraps, old-key removal and permission denial. HTTP rewrap is now also exercised by the real-database regression suite. No actual key values or private filesystem debug output remain in production logging.

## Safety and failure review

- Authentication derives membership and canonical project/environment authority. Internal execution checks current adult identity/session/membership/grant versions before bounded SQL decisions and dispatch. Children cannot use raw inference; Chapter 03 must build the approved preset execution path. API org selection is not authority.
- Provider SQL uses a separate runtime-role pool and transaction-local org context; it never receives the identity pool. Tables use forced RLS and tenant composite references. Global instance budget rows are hidden without the internal transaction flag and global totals have no tenant API. Host/database administrators remain trusted.
- Credentials use AES-256-GCM with organization, connection, credential version and key ID in authenticated data. Only the API receives optional protected key files. Browser DTOs expose no ciphertext/token. Native transports do not send credentials on catalog requests and reject upstream secret echo. Secrets are absent from queues/prompts; no queue exists yet.
- Endpoint/model selection is operator-owned. Fresh validated DNS addresses are pinned into the actual native HTTP/TLS connection. Redirects/compression/streaming, response/header sizes and deadlines are bounded. No arbitrary API URL, upstream fallback array or automatic SDK retry exists.
- Free-only rejects stale, incomplete, nonzero or unenforceable price evidence. OpenRouter's real adapter remains ineligible under strict zero-spend policy. Synthetic hosted proof in tests is an injected fixture, never production configuration. Ollama local classification requires operator cloud-disable attestation plus installed metadata, not an assertion that CPU/electricity are free.
- PostgreSQL reserves all required scope counters in stable order. Dispatch is durably marked after metadata/DNS and current authority/policy/stop checks. No SQL transaction spans external I/O. External effects cannot be atomically rolled back after stop/revocation; dispatch uncertainty is conservatively held.
- Active reservations survive restart/hour rollover. Observed token settlement may reduce tokens; money remains a conservative estimate. Unknown outcomes hold the maximum. Explicit adult quiescence reconciliation fences undispatched calls or charges marked calls fully before releasing concurrency. Duplicate settlement is idempotent; positive corrections never silently replace history and overruns latch stop.
- Provider stop persists and is separately cleared. It is currently an org/instance provider control, not the complete mission/world emergency-stop and in-flight cancellation system. That composition, worker authentication, leases, outbox/reconciliation and canonical runtime entities remain Chapter 03.

## Performance and user verification

Concurrent fake requests verify quota serialization and absence of unreserved dispatch; they are correctness tests, not throughput or model benchmarks. No Intel N150, inference latency, GPU/CPU model capacity or provider availability claim is made. Existing account journeys and mobile viewport regressions are rerun separately from provider API tests. No new provider frontend is advertised.

## Known limitations and unresolved work

- Owner acceptance and independent security review remain pending. Real Ollama/OpenRouter inference, downloaded models, external billing, public TLS and production egress qualification were not run. Strict hosted free-only remains unavailable without complete enforceable evidence.
- Mission/task UUIDs group budgets but are not canonical runtime authority yet. CPU/tool/execution/storage units, per-mission policies, queue identity/outcome persistence, worker leases/fences and wider stop propagation belong to Chapter 03 onward. No agents run in this chapter.
- Request replay blocks reuse rather than caching output; quota-denied claimed request IDs also need new attempt IDs. Runtime must persist outcomes before retry orchestration. The dispatch mark intentionally overcounts crash-before-send uncertainty rather than refunding an unproven effect.
- Lists/reports are bounded at 100 records; no cursor/export/global admin dashboard or automatic retention/pruning. Credential-key removal needs verification across every organization, not one truncated listing. Production backups/key restore, retention and dependency/license/vulnerability review remain Chapter 09; D-06/D-24 track scope.
- Hosted DNS resolution is IPv4-only in this slice. Local endpoints support explicit private IPv4/IPv6 pins. Ollama cloud-disabled configuration remains an operator trust assertion. The optional egress network does not substitute for host firewall/provider restrictions against a compromised trusted API process.

## Review decision and handoff

- [x] Required task evidence complete and accurate.
- [x] All acceptance criteria met or explicit scope amendment reviewed.
- [x] No unresolved blocking safety/correctness issue identified by implementation checks.
- [x] Docs/backlog/status/ADRs updated consistently.

Decision: **pending owner review**. Next chapter begins with **CL-03-01 runtime schema and state machines**, subject to Chapter 03 authorization. Read [the handoff](../delivery/handoffs/02-provider-gateway.md), chapter and current status before further work. Every build step must update plans, commit/push `origin main` and verify clean synchronization.
