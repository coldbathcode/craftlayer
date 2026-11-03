# Chapter F1 review — Read-only server dashboard

**Implementation state:** verified locally; production qualification unexecuted. **Acceptance decision:** owner advancement pending. **Reviewer:** local engineering self-review, independent review unassigned. **Date:** 2026-11-02 UTC. **Commit/tree:** CL-F1-01 `aa35729`, CL-F1-02 `3224f1e`, CL-F1-03 task commit recorded in Git after this review. **Authorized scope:** user’s “go to the next steps” after F0 authorizes local F1; no production access or changes.

## Delivered behavior

CL-F1-01 introduces strict server/operation contracts, additive scoped migration 0016, explicit management permissions and a framework-independent domain service. CL-F1-02 adds protected captured inventory, optional bounded Java status-only observations, REST/OpenAPI 3.1 and typed SDK, durable receipts/idempotency/fences and metadata-only unregister/reactivation. CL-F1-03 adds `/servers` and an Account navigation link: approved-source plan/register, server/detail/player/activity views, timestamp/provenance/freshness, game connection instructions, source failure and explicit identity/allowlist/network/recovery gaps. No bots/models/providers are required. PR-024/025/028/035 apply; [ADR 0017](../architecture/decisions/0017-minecraft-observation-boundary.md) records boundaries.

The earlier account/provider/runtime services are preserved. The dashboard observes stored facts and approved sources; it never moves, recreates, starts or controls a Minecraft deployment. F1 is the earliest usable local observation preview, not the family-ready F2 milestone.

## Acceptance evidence

| Task / acceptance portion | Exact command / procedure | Result | Evidence / limit |
| --- | --- | --- | --- |
| CL-F1-01 / MC-01/06 | `pnpm test:db` at CL-F1-01 | PASS / 0; 95 integration cases | Real restricted PostgreSQL roles, old-tenant permission upgrade, scope/RLS/FKs, child-extra-admin ceiling, concurrent replay/conflict, atomic audit/outbox; disposable DB only |
| CL-F1-02 / MC-01/02/05/06 | `pnpm test:db` at CL-F1-02 | PASS / 0; 99 cases | Actual Fastify/auth/CSRF/OpenAPI, unknown fields and remote denial, request/audit correlation; revocation during source I/O, unregister fences and same-binding reactivation; migration fresh/repeat/upgrade/rollback/checksum proofs |
| CL-F1-02 sources / MC-02/05 | `pnpm check` | PASS / 0; 246 unit cases across 24 files | File owner/mode/symlink/size/tenant limits; private endpoint restrictions, fixed status packets, timeouts/oversized input and discarded untrusted fields; no real game |
| CL-F1-03 / MC-01/05/12 | `CRAFTLAYER_BROWSER_REVIEW=1 pnpm test:server-ui` | PASS / 0; one complete journey, 37.0s | Production images, ordinary synthetic adult/viewer/child sessions and source; scoped browser/REST flows, source failure, mobile/focus, metadata removal; container inventory/credential separation |
| Production compilation | `pnpm build` | PASS / 0 | Next production `/servers`, API/SDK/server packages; not a deployment |
| Lint/types/regression/docs | `pnpm check`; `git diff --check` | PASS / 0 | Current preserved working tree; no hosted clean-commit CI claim |
| Local preservation/recovery | F0 review’s synthetic byte-copy/hash rehearsal | Previously passed, not rerun by F1 | No backup/restore feature or game boot is implied |

Host: macOS arm64, Node 22.23.3/pnpm 10.23.0, TypeScript 5.9.3, Next 16.4.3/React 19.3.1, Fastify 5.12.7, PostgreSQL 18 and pinned Compose images, Docker 28.2.2, Playwright 1.64.1 Chromium, agent-browser 0.27.0. Check exact package pins rather than assuming latest versions. Synthetic `play.example.invalid` connection instructions and `FixturePlayer` names do not identify any production data.

## Safety and failure review

Current membership/role/resource scope and child ceiling are checked in domain/API, including replay and after external observation I/O. Strict input contracts contain no Docker/shell/RCON/pass-through controls or caller paths. Forced RLS, tenant FKs, immutable target binding and terminal receipts, explicit grants and transaction-local organization settings preserve tenant boundaries. Session UUID is guard-derived without an unsafe cross-pool global-session FK. Shared session locks serialize authority with effects rather than relying on UI checks.

Observation attempts persist before bounded I/O, commit only under current registration/fence/authority and retain prior data on failure. Unregister fences pending reads and removes registration metadata only; same immutable binding can be reactivated. No physical effects/exactly-once claim, game stop clearing, mutable queue consumer or AI approval mechanism exists in F1. Audit/outbox are atomic and contain bounded references. Remote routes fail closed for non-loopback public URLs; private TLS/MFA and effective public network isolation remain unqualified. Operator-owned inventory contains no credentials and is API-only/read-only; no world or Docker mounts are introduced.

Removal requires exact-name confirmation in the UI and authoritative server permission/version/idempotency checks. It retains audit/world/container data. Code rollback means reverting the UI/service change through a new reviewed commit while retaining additive schema/history; never down-migrate/delete rows or touch a world as a rollback. F0 preservation and approved backup/restore remain mandatory before live writes. No Contabo or main-installation migration/deployment occurred.

## Performance and user verification

Bounded 50-server pages, 30 activity items, 100 player names, four file/status reads per API, 64 KiB inventory/status response, 1s socket/2s source deadline and 60s freshness. Visible-tab metadata polling is every 30s and does not issue an Observe network request. After REV-03/A (2026-11-03), operation admission limits are twelve actor/environment writes/minute and 10,000/environment per rolling 24 hours; historical rows remain retained. This is no production load or large-world benchmark.

Browser evidence uses ordinary sessions on an isolated random loopback edge with zero providers and captures desktop/390px screenshots in ignored `test-results/servers`. Review checks keyboard skip/focus, no horizontal overflow, stale/offline/online/unavailable data, tenant switching and lost session cleanup. Screenshots complement behavioral assertions, not a security proof. Screen-reader and actual family usability remain manual gaps.

## Known limitations and unresolved work

Real Contabo state, immutable binding derivation, Paper/Geyser/Floodgate compatibility and clients, identity/allowlist/spoof/rejoin, effective firewall/public edge/private TLS/MFA, live world preservation and playable encrypted off-host restoration/RPO/RTO remain unexecuted. Java status returns only state/count and proves no policy. Sources are operator-configured; no live agent discovery/enrollment, RCON, Docker/node/provisioning, backup or lifecycle feature exists. F1 remote privilege is blocked, not approved by a loopback proxy. No family/production-ready claim.

Five unrelated entry-dirty runtime/test files remain byte-for-byte unchanged and uncommitted; Chapter 03 CL-03-07 stays open. Full checks run in that preserved working tree, not acceptance of those edits. Task-owned files must be committed/pushed; whole-tree clean state cannot honestly be claimed while preserving unrelated edits.

## Review decision and handoff

- [x] Required local task evidence complete and accurate.
- [x] Local preview scope and real/manual readiness gaps explicit.
- [x] No unresolved local defect after final verification.
- [x] Linked chapter/track/status/risk/runbook and handoff prepared.

Decision: **local review prepared; owner advancement pending**. F2 remains unauthorized. Next CL-F2-01 must pin compatible server/plugin fixtures and verified identity provenance/enrollment; real client evidence is required to close compatibility. Live inventory or changes still need separate explicit authorization. [Handoff](../delivery/handoffs/F1-control-plane.md).

REV-04 follow-up (2026-11-03): Observe now reports current authorized source timestamp/freshness rather than implying capture advancement. Isolated `pnpm check` PASS/0 (355 unit cases) and production-image `pnpm test:server-ui` PASS/0 (one 36.0s journey/36.9s runner, production build/isolation/cleanup). Browser verifies unchanged stale then fresh source notices alongside existing security/failure/mobile/keyboard regressions; mobile screenshot inspected. Initial extra-observation strict-locator failure corrected to assert both legitimate activity rows. No API/history/permission change or family/production qualification. [Handoff](../delivery/handoffs/REV-04-observation-freshness.md).

REV-03/A (2026-11-03): isolated `pnpm check` PASS/0 (355 unit cases), `pnpm test:db` PASS/0 (167 cases plus migration proofs). Two new real DB cases prove rolling day/minute refusal/reclaim, current replay/no extra source query and retained history/old operation reads beyond the former 10,000 lifetime cap. No schema/permission/game effect; storage retention and enrollment cap/dedupe remain open under ADR 0028. [Handoff](../delivery/handoffs/REV-03-operation-budgets.md).

REV-09 (2026-11-03): main/PR workflow now schedules a separate management-browser job with pinned actions/read-only token/bounded artifacts. Explicit suite matching and fixture validation prevent silent dashboard skips. Local `pnpm check` PASS/0 (355 unit), `pnpm test:server-ui` PASS/0 (one full journey, 7.0s/8.1s runner); negative/discovery probes and workflow YAML parse pass. Publication source matches the tested tree; hosted outcome is pending at publication, branch protection unchanged. No physical/production readiness claim. [Handoff](../delivery/handoffs/REV-09-dashboard-ci.md).
