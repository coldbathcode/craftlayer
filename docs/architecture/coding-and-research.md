# Coding and research execution design

Status: proposed Chapter 08 detail. Both environments treat model output and external content as untrusted. Neither is accessible to Child accounts.

## Coding trust model

A trusted broker creates a short-lived isolated runner for one organization/mission. API/web/general workers do not receive Docker daemon control. The broker has a narrow schema for approved images, bounded resources, fixed mount roots and network policy; arbitrary host mounts, privileged flags and raw Docker options are absent.

Local self-hosted use may initially support trusted operator repositories with strong container restrictions. Hosted hostile code requires an isolation decision such as dedicated VM/microVM or equivalent reviewed boundary. Do not call a shared container process a tenant sandbox. Document actual tested escape/egress assumptions and platform limitations.

Runner receives workspace bytes/base revision, approved commands, ephemeral artifact capability and task limits. Provider calls remain in the trusted router; generated code does not receive keys. No SSH agent, host home, cloud metadata, production secrets, credential helper or Docker socket. Network is denied by default; explicit package-registry access is a bounded separate policy.

## Git and patch workflow

1. Validate repository source and immutable base SHA; clone/fetch only from approved destinations. Disable untrusted hooks/submodules/credential helpers and document Git configuration.
2. Create a per-mission worktree/checkout. Resolve paths against the real workspace root and guard symlink escapes.
3. Architect produces bounded plan/files and acceptance cases. Developer proposes patches inside allowed paths.
4. Apply patch, inspect changed paths and run allowlisted executable/argv commands with fixed cwd/env, no shell interpolation, CPU/RAM/PID/runtime/output limits.
5. Tester independently verifies fixture behavior and preserves failures. Reviewer inspects diff, test evidence and policy violations; model agreement alone is not approval.
6. Export unified diff, base SHA, touched files, dependency changes, exact tests/results, review notes and artifact hashes. Do not push, merge, deploy or create external PRs unless separately authorized.

Dependency installation is code execution through package scripts/transitive packages. Disable lifecycle scripts by default and require an explicitly approved installation policy if needed. A command allowlist must validate argv semantics; allowing an executable name alone is insufficient when it can execute arbitrary subprocesses.

## Habit tracker fixture

Use a small pinned synthetic repository, no production data. Required behavior: create a named habit, toggle completion for a date, show a daily list, persist through the fixture's approved storage mechanism, validate empty/oversized input and display loading/error states. Architectural choices are bounded by fixture requirements, not invented cloud services.

Acceptance output is a patch plus passing independent behavior tests. Tests that merely echo implementation or a generated “tests passed” string do not count. Failed tests are included in the review; no silent deletion to reach green.

## Approvals

Before a destructive action or external deployment, present exact action/command, target/environment, diff/artifact digest, expected effects and rollback. Bind approval to all of these plus org/principal/policy version and expiry. Another authorized adult approves; requester cannot self-approve. Recompute immediately before dispatch. Modified diff/target/command invalidates approval. Store decision and one-time consumption atomically.

The default example ends at a reviewable patch and needs no external deployment. Actual deployment credentials, when later authorized, belong in a separate privileged deployment mechanism rather than generated-code execution context.

## Research retrieval and isolation

Public HTTP(S) sources only by default. URL parser canonicalizes host/scheme/port and rejects credentials, unsafe schemes and private/link-local/loopback/metadata destinations including IPv6 forms. Resolve and validate each redirect/connection, cap redirects/size/time/MIME and use controlled egress to prevent DNS rebinding. A simple initial URL regex is insufficient.

Research fetch policy differs from an adult-approved local Ollama endpoint. A page cannot add a trusted internal host or request cookies/authenticated user data. Respect configured access/request limits and do not bypass authentication or access controls. Record unavailable sources without fabricating their content.

Extract text to a bounded untrusted document object with source URL, title, published/updated date when found, access timestamp, extraction version and content hash. Retain minimal snapshots/excerpts within configured policy; do not republish entire copyrighted sources in reports. Separate facts, source claims, analyst inference and unresolved questions.

## Research team and claim ledger

Researcher gathers permitted sources → Verifier checks authority/date/claims → Analyst compares normalized criteria → Writer renders Markdown. Each claim has ID, text, source references, quote/excerpt where permitted, date relevance, support status and confidence rationale. Independent deterministic checks require citations for material factual statements and flag unsupported/contradictory/stale claims.

Hosting comparison fixture uses synthetic snapshots with pricing dates, different currencies/units, missing data and contradictory claims. Normalize comparable units only when justified; otherwise mark not comparable. Do not invent real-time prices or recommend a purchase from stale fixtures. Live research requires current source verification.

## Markdown report contract

Include title/question, scope and access date, comparison criteria, findings table, claim-linked citations, uncertainty/contradictions, clearly labeled analysis, limitations and source list. Each material factual claim links to supporting source. Report metadata includes mission/template/model versions and artifact hash, without private prompts or credentials.

Quality gates: no fabricated URL/title/date, every citation resolves to a captured allowed source, claim support is checked, material contradictions are acknowledged, and private/child data is absent. A model-generated self-score is supplementary evidence only.

## Cleanup and recovery

Stop terminates process groups, network capabilities and artifact upload tokens. Confirm no orphan child processes or writable mounts. Preserve approved patch/report artifacts and redact diagnostic output; delete workspaces and transient sources on schedule. Interrupted coding commands may have partial filesystem changes; record them rather than rerunning blindly. Research retries consume request/time quotas. Worker reconnect revalidates grant/stop before recreating a runner.
