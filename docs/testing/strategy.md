# Verification, fault injection and release quality

Status: Chapters 00–02 and CL-03-01–06 have recorded executed evidence in [current status](../delivery/status.md) and reviews; CL-03-07 remains open. Later chapter and Minecraft management suites are planned. Original planning-only validation remains historical evidence.

## Test pyramid and environments

| Layer | Purpose | Environment |
| --- | --- | --- |
| Unit | Pure policies, state transitions, DAG validation, pricing math, redaction | Fake clock, deterministic fixtures, no network |
| Contract | Provider/adapters, schemas, OpenAPI/client compatibility | Recorded synthetic responses, fake transports |
| Integration | RLS, FKs, transactions, budgets, outbox, leases, sessions | Real PostgreSQL/Redis containers with least-privileged roles |
| End-to-end | Adult/child workflows, event reconnection, CLI, API authorization | Browser/CLI plus local stack/fake providers |
| Environment | Mineflayer and deterministic blueprint result | Pinned private Java server and seeded test worlds |
| Sandbox | Coding/research isolation and approval controls | Dedicated restricted runner and egress fixtures |
| Reliability | Crash, partition, replay, expired lease, restore, migration | Fault hooks, process kill, controlled network loss |
| Evaluation | Plan quality and cited report quality | Versioned datasets and deterministic judge rules; real models opt-in |

Choose meaningful behavior tests rather than implementation mirrors. API integration tests use actual authorization and scoped DB roles; mocking the permission check cannot prove isolation. CI fakes cannot substitute for pinned Minecraft/sandbox acceptance tests.

## Requirement-to-evidence map

| Requirements | Required scenarios | Owning chapters |
| --- | --- | --- |
| PR-001, PR-018 | Fresh deployment without Cloud; backup/restore/upgrade | 00, 09 |
| PR-002–004, PR-021 | Role/resource/child matrix, RLS/pool reuse, disable/revoke, credential canaries | 01–02 |
| PR-005–007, PR-014 | Provider contracts, free-only adversaries, hierarchical budget races and uncertain usage | 02, 07 |
| PR-008–009 | DAG cycles, duplicate claims, stale fences, crash/restart, stop partitions | 03 |
| PR-010, PR-013 | Connect/move/stop; two-bot resource transfer/build; verify world state | 04, 06 |
| PR-011–012 | Three-step child launch, inaccessible settings, viewer writes denied, live resync | 05–06 |
| PR-015–016 | Reviewable patch plus independent test results; supported dated claims | 08 |
| PR-017, PR-022 | API/SDK schema compatibility, CLI permissions, custom adapter fixture | 00, 03, 07–09 |
| PR-019–020 | Cloud boundary analysis and separate tenant/billing gate | 10–11 |
| NFR-01–10 | Benchmarks, accessibility, stop deadline, restore, resource soak and network audit | Relevant chapter plus 09 |

## Mandatory adversarial suites

Tenant suite: direct guessed IDs; list/filter/count/export; cross-org FK writes; missing context; sequential pooled connection reuse; foreign event cursor; forged queue scope; wrong worker identity; artifact path traversal; mixed-org group members; revoked membership while connected.

Budget suite: stale/nonzero/unknown prices; hidden paid fallback; malformed decimal; concurrent reservation; duplicate settlement; provider usage missing; call interrupted after upstream dispatch; retry amplification; policy tightened between reservation and effect; unknown compatible endpoint price.

Runtime suite: duplicate deliveries; two schedulers; worker killed before/after effect and before result commit; queue data loss; stale lease heartbeat; old worker writes; approval patch mutation; task cycle; exhausted retry; stop committed during claim; control-plane partition with active bot.

Child suite: create/edit arbitrary mission; use unapproved template version; select forbidden world; add coding/research tool; view provider key/settings/log; attack player; clear stop; change roles; call same forbidden endpoints via CLI/WebSocket. Negative tests must assert no effect/secret, not just HTTP status.

## AI evaluation datasets

Version scenarios with prompt/template/model config hash and expected observable outcomes. Use schema/permission/outcome assertions as primary judges. Do not ask the same model to certify its own success. Coding is verified by repository diff and tests; Minecraft by world state; research by source/claim mapping.

Initial benchmark set: 20 bounded planning fixtures (valid and invalid), 10 injection fixtures across chat/repo/web, 10 routing/error fixtures, 3 seeded shelter runs, one habit-tracker coding fixture and one hosting comparison dataset containing contradictions/stale evidence. Expand based on discovered failures. These counts are planned coverage targets.

## CI design

Every PR: secret/document/link checks, lockfile validation, lint, strict typecheck, unit/contracts, dependency boundary check, build and integration suite for affected domains. Main/release: complete integration/browser/sandbox/Minecraft acceptance and image checks. Heavy tests may be scheduled, but are required before their chapter/release gate and cannot be silently skipped.

Pin actions/images/dependencies; configure least-privilege workflow tokens. External pull requests never receive production/provider secrets. Local provider/network fakes are the default. Publish redacted reports and failure artifacts with bounded retention. Protect against unrelated test processes making real inference calls by network deny rules.

## Evidence format and flake policy

For every check record exact command, commit/tree identifier, environment versions, result/exit code, duration, fixture/seed and artifact path. Label manual checks with operator/date and remaining limitations. A missing Docker daemon or unavailable server is blocked/unverified, never a pass.

A flaky safety test blocks the gate until understood. Quarantining a non-safety test requires owner, issue, expiry and replacement evidence. Do not rerun indefinitely until a green build hides a defect. After a change, rerun the affected checks; broaden only for changed dependencies, failure or unresolved risk.

## Performance acceptance

Keep a versioned benchmark script with warmup, duration, concurrency and host profile. Report p50/p95/p99 and errors, not averages alone. Measure stop request acceptance separately from physical quiescence, model latency separately from API latency, and resource use with/without Ollama. Record results against NFR targets and document justified adjustments before release.

## Unified Minecraft gates

[MC-01–12 acceptance matrix](minecraft-management.md) maps PR-023–035 to F0/F1/F2/F25/F3 and all unified §16.9 cases, with mock-engine, actual Docker, real Java/Bedrock client and isolated restore requirements. [Deployment checklist](../security/DEPLOYMENT_CHECKLIST.md) tracks live/manual evidence. No Minecraft gate has been executed by REC-01. Documentation checks prove structure only. Existing simulation tests cannot qualify physical game access, world preservation, public-port isolation, backup recovery or node host security.

F0 local implementation now has ten preflight tests and seven preservation/synthetic recovery cases, included in `pnpm check` (215 current worktree tests). [F0 review](../reviews/F0-preflight.md) scopes these results: no actual game archive/boot/restore, off-host/keys/network/production readiness proof. F1 remains separately authorized work.

REV-07: the management integration suite compares actual migrated global permission IDs and built-in role/permission seed pairs with the canonical TypeScript registry. Run via `pnpm test:db` to include real fresh/repeat/prior-schema-upgrade/rollback/checksum fixtures. TypeScript `satisfies` additionally rejects unknown organization permission names in role/delegation constants. These checks detect drift without granting permissions or certifying the intended role policy.

REV-09: the main/PR workflow now includes an unconditional `management-browser` job running `pnpm test:server-ui` against its own disposable production-image installation. Existing pinned actions/lockfile, contents-read workflow token, 15-minute job bound and separate seven-day failure reports apply; no production secrets. Playwright selects one named suite rather than collecting unrelated fixture specs. The management spec fails when fixture configuration is absent; direct invocation without the wrapper cannot silently skip and appear green. Use `pnpm test:e2e` for foundation, `pnpm test:identity-ui` for identity and `pnpm test:server-ui` for management. Hosted run outcomes and branch-protection requirements must be checked separately.

REV-09 clean-checkout correction: `pnpm test:server-ui` now runs `pnpm build:server` before importing certificate/identity fixtures. Never assume another job or local development already compiled workspace package exports. The wrapper only invokes Compose teardown after its own configured Compose startup was attempted; an earlier build/setup failure retains its original error and still removes temporary files. The first hosted browser job exposed this dependency and failed before a browser test; that failure is not relabelled as passed.
