# Chapter 08 — Coding and research adapters

**Status:** not started. **Specification:** ready for engineering review. **Implementation evidence:** none.

**Milestone:** M3. **Requirements:** PR-009, PR-015–016, PR-021–022.

## Objective

Demonstrate reviewable code changes and source-supported research through isolated, bounded adapters with exact-action approvals.

## Dependencies and entry gate

Chapters 00–07 accepted. Runtime, provider policy, approvals primitive and artifact/event contracts are stable.

Before work: inspect Git status, read AGENTS.md and delivery status, confirm the authorized chapter scope, and inspect the previous review evidence. Do not assume a dependency is complete merely because its specification exists.

## Scope and implementation approach

Separate sandbox broker/runner, Git workspaces, argv command allowlist, patch/test/review workflow, safe research fetch/extraction, claim/citation ledger and Markdown reports.

Coding/research are untrusted content domains. Trusted worker retains control-plane/provider credentials; runner receives short-lived minimum-capability inputs. Child accounts never access either adapter.

Architecture references: [coding-and-research](../architecture/coding-and-research.md), [security-and-access](../architecture/security-and-access.md), [runtime-and-agents](../architecture/runtime-and-agents.md).

## Ordered engineering tasks

Each task is initially unchecked. Dependencies below describe the default conservative order; record an explicit justified dependency change before reordering. Task sizes are relative engineering complexity (M/L), not delivery dates.

### [ ] CL-08-01 — Sandbox threat model and runner spike

**Depends on:** Chapter 07 gate. **Size:** L. **Status:** not started.

**Implementation:** Choose tested isolation/runtime for local trusted use and document limits for hostile hosted tenants. Implement narrow broker API, resource/PID/runtime/egress limits and no host/socket mounts.

**Required evidence:** Fixture cannot read host secrets, reach control DB/metadata or execute outside workspace; limitations are explicit.

### [ ] CL-08-02 — Coding workspace and command policy

**Depends on:** CL-08-01. **Size:** L. **Status:** not started.

**Implementation:** Create per-mission Git checkout/worktree with validated repository/base ref and path boundaries. Allow explicit executable/argv patterns and bounded output; disable arbitrary shell and dependency lifecycle hooks by default.

**Required evidence:** Traversal/symlink/argv injection and forbidden network/process/file operations deny.

### [ ] CL-08-03 — Coding team workflow and artifacts

**Depends on:** CL-08-02. **Size:** L. **Status:** not started.

**Implementation:** Implement Architect→Developer→Tester→Reviewer tasks using immutable base, bounded patch and independent test results. Export diff, base SHA, commands/results and review notes.

**Required evidence:** Habit tracker fixture yields reviewable patch without committing/pushing/deploying externally.

### [ ] CL-08-04 — Exact-action approval gates

**Depends on:** CL-08-03. **Size:** L. **Status:** not started.

**Implementation:** Bind approvals to patch/target/command/config digest, scope, policy, requester and expiry. Invalidate on mutation/revocation; require independent appropriate adult approver.

**Required evidence:** Self approval, stale diff, changed deployment target and replay fail; unapproved deployment never runs.

### [ ] CL-08-05 — Research safe retrieval and provenance

**Depends on:** CL-08-04. **Size:** L. **Status:** not started.

**Implementation:** Implement public-only fetch with DNS/redirect/egress checks, size/time/request limits, extraction as untrusted data and source snapshot hashes/access dates.

**Required evidence:** SSRF/metadata/rebinding/oversized content and page injection fixtures deny or remain harmless.

### [ ] CL-08-06 — Claim verification and report production

**Depends on:** CL-08-05. **Size:** L. **Status:** not started.

**Implementation:** Build Researcher→Verifier→Analyst→Writer DAG, claim/source mapping, contradiction/staleness handling and dated cited Markdown report. Mark unavailable/unsupported claims explicitly.

**Required evidence:** Hosting comparison report supports material factual claims and does not invent inaccessible sources.

### [ ] CL-08-07 — Isolation/evaluation review and examples

**Depends on:** CL-08-06. **Size:** L. **Status:** not started.

**Implementation:** Run sandbox negatives, approval TOCTOU tests, coding fixture tests and citation evaluation. Document safe presets, cleanup/retention, egress configuration and known limitations.

**Required evidence:** Both examples are reproducible with fake/local models, no production secrets and no paid or public deployment.

## Test plan

- Path/symlink traversal, command/shell injection, dependency install hook and network exfiltration.
- Timeout/OOM/fork/process cleanup and stop partition; broker cannot create arbitrary host mounts.
- Changed diff/target/policy invalidates approval, self approval/replay denied.
- SSRF/redirect/DNS/private IPv6, prompt injection, citation fabrication and conflicting sources.

Use deterministic/fake services first. Any live inference, public deployment, publication or payment action needs existing user authorization for that action; local tests must not silently use real keys. Record exact commands, versions, fixture seeds and exit results. An unavailable dependency is unverified/blocked, not passed.

## Security considerations

- Control-plane/provider credentials never enter generated code, repo context or runner.
- Untrusted multi-tenant hosted code requires stronger isolation than a shared process/container assumption.
- Research respects configured privacy, request limits and source access constraints; no authenticated private fetch by default.

## Acceptance criteria

- [ ] Coding team emits patch/base SHA and independent test evidence for the fixture.
- [ ] Research team emits dated report with verified claim-to-source mapping.
- [ ] Approvals and isolation negatives pass; child access and external deployment are denied.
- [ ] Required tests pass, relevant documentation is updated, and no unreviewed safety regression remains.
- [ ] Every completed task points to concrete evidence; deferred checks are explicitly listed with impact.

## Demonstration and independent verification

Generate a habit tracker patch and cited hosting report, attempt a changed-diff approval and metadata URL fetch, and show both denied.

## Documentation and deliverables

Sandbox/egress architecture; runner/broker contracts; coding/research examples; artifact/report schemas; eval results.

Update the OpenAPI/SDK or configuration reference when changed, add migrations/compatibility notes, and capture limitations. Use a dedicated chapter review document based on [the review template](../templates/chapter-review.md). Do not edit the original source blueprint.

## Review checkpoint and next handoff

Fill the chapter review with implementation summary, task/requirement mapping, checks, security evidence, benchmark results where relevant, known issues and next steps. Update [status](../delivery/status.md), [backlog](../delivery/backlog.md) and [decisions](../delivery/risks-and-decisions.md) together. A chapter is accepted only when its acceptance evidence is reviewed.

Complete the authorized scope before asking for the next chapter. Default chapter-by-chapter authorization follows the blueprint; an explicit user instruction authorizing multiple chapters overrides that default. Use [the handoff template](../templates/agent-handoff.md) so the next session can resume without reconstructing context.
