# Chapter 03 review — Fleet engine

**Implementation state:** implemented and locally verified. **Acceptance decision:** pending owner review. **Reviewer:** Codex implementation self-review; independent reviewer unassigned. **Date:** 2026-11-03 UTC. **Commit/tree:** CL-03-07 task commit containing this review, based on `8ff2a69`. **Authorized scope:** original Chapter 03 continuation and subsequent request to finish authorized steps and publish each checkpoint. No production or Chapter 04 authorization.

## Delivered behavior

The simulation runtime provides finite snapshotted DAGs, current scoped execution authority, fair durable dispatch, registered workers, leases/fences, bounded model proposals, independent approvals, persistent emergency stop, scoped replay/SSE and conservative recovery. CL-03-01–07 cover PR-007–009, PR-017, PR-021 and NFR-02–05 within the simulation boundary. See [chapter](../chapters/03-fleet-engine.md), [ADR 0014](../architecture/decisions/0014-runtime-authority-and-recovery.md) and [runbook](../development/runtime.md).

This final checkpoint publishes the five runtime/test files preserved from earlier work and corrects nested event permission guards: mission-read and dedicated event-read now validate in one identity transaction. Twelve simultaneous event-page reads guard against pool exhaustion. Exhausted provider budgets project a distinct budget block before dispatch. The fault harness pins local Docker, tests actual disposable processes and redacts worker token components. No model, game, sandbox or external tool execution is added.

Changed files: runtime event/model services; secret scanner and runtime-stack harness; database integration tests; chapter/review/handoff/runbook/ADR; README/docs index; delivery status/backlog/build log/risk record. The original blueprint and unrelated full-project review are preserved.

## Acceptance evidence

| Task / criterion | Exact command | Result / exit | Evidence |
| --- | --- | --- | --- |
| CL-03-01–06 / strict graphs, contracts, watchdog, cursor parsing | `pnpm check` | PASS / 0; 355 unit tests in 41 files | Lint/boundaries, strict server/test/web types, unit suite and docs structure |
| CL-03-02–07 / permission, race, budget, approval, recovery | `pnpm test:db` | PASS / 0; 174 tests in seven files | Real PostgreSQL/Redis, current scoped grants, tenant/child denials, 100 claim/replay and 100 claim/stop races, stale-fence denial, no duplicate committed result, provider-budget zero dispatch, approval rejection, paired event guards and revocation |
| CL-03-07 / process faults and full mission | `pnpm test:runtime-stack` | PASS / 0 | Production-image CLI/API/registered worker, parallel two-agent DAG, scoped SSE, stop/API restart, Redis reconnect without API restart, SIGKILL after prepared receipt, API partition/watchdog, conservative reconciliation, token/log separation and cleanup |
| Migration integrity through SQL 0024 | `pnpm test:db` | PASS / 0 | Fresh/repeated/prior-role upgrade, rollback and checksum tamper proofs |

The 2026-11-03 workspace run measured partition stop acknowledgement at **611 ms**, target ≤20,000 ms for simulation. The final isolated task snapshot also passed all three commands with 355 unit/174 database cases and a 669 ms partition acknowledgement; exact results are recorded in the [build log](../delivery/build-log.md). No hosted CI outcome is claimed for this checkpoint. Earlier evidence remains in the build log without relabelling it as newly executed.

Environment: macOS arm64, Node 22.23.3, pnpm 10.23.0, Docker 28.2.2, PostgreSQL 18, pinned BullMQ 6.5.3/ioredis 6.0.0/Vitest 5.0.5. Fixture: disposable local installation with random tenant/worker IDs, finite `fixture.*` graph, synthetic credentials and fake providers; no world seed applies. Instance/provider safety policies remain enforced. The first strict check rejected an incorrect snapshot-array test access; corrected before all final checks passed.

## Safety and failure review

Worker queue hints cannot authorize effects; canonical membership, current grants, scope, generation, deadlines and fences remain authoritative. Worker containers have no identity DB/provider-key authority. Both event permissions are revalidated before bounded output; removing either closes delivery. Tests cover session/role revocation and foreign cursors. Budget/provider refusals cannot dispatch inference. Independent approval never grants new permissions; rejection produces no effect and releases only inactive capacity.

Stop remains durable across API restart; clear never resumes. Redis loss cannot erase mission state. Prepared crash/unknown effects retain capacity until explicit revoked-worker, expired-lease and exact-evidence adult reconciliation; they are never silently retried or called successful. Simulation acknowledgement is distinct from known external quiescence. Child simulation access remains denied. No physical exactly-once, game identity, host isolation or production restore claim is made.

## Performance and user verification

The single local partition observation meets the simulation bound; fake-clock watchdog tests also cover hung heartbeat expiry. Twelve concurrent event reads complete using the five-connection identity pool. Neither result establishes production throughput or percentile latency. CLI/API/SSE journeys are automated; this checkpoint does not change UI, so no new visual/manual accessibility result is claimed.

## Known limitations and unresolved work

Owner acceptance and independent security review remain pending. Production multi-instance admission/proxy/load, retained-history archival/disk supervision, real game/sandbox shutdown and reference-host timings remain unqualified. Chapter 04 requires separate authorization. F2/F25/F3 management still needs real player identity/access, independent deployment approval, storage qualification, verified backup/isolated restore and private installed composition. No VPS, existing world, paid inference or Cloud operation ran.

## Review decision and handoff

- [x] Required simulation task evidence recorded.
- [x] Acceptance criteria covered for the explicit simulation scope.
- [x] No known unresolved blocking simulation correctness issue in the checked scope.
- [x] Docs/backlog/status/ADR updated.

Decision: **pending owner acceptance**; prepared implementation review is not independent certification. Continue authorized local F2/F25/F3 work, starting with pending enrollment deduplication under REV-03. Do not start Chapter 04 or touch production. See [handoff](../delivery/handoffs/03-fleet-engine.md).
