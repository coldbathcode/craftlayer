# CraftLayer session handoff — CL-F25-03/K2

**Date:** 2026-11-07 UTC. **Agent/session:** Claude Code. **Branch/base:** main, `ce1593e`. **Authorized scope:** local F2/F25/F3 and task commits/pushes; no Chapter 04, production or live world action.

## Current state

`DeploymentAdmissions` now has `decideApproval`, `revokeApproval`, `approvalDecision` and `currentApproval`, backed by SQL 0027. Decisions are immutable evidence bound to one exact review. Approval needs two distinct current adults; rejection and revocation need one and work during a stop. `approvalRequest` now projects `decided` with `decision_id`. Nothing calls `currentApproval` yet, no route exists, and `DeploymentJobs` still denies without a real qualifier. See [ADR 0032](../../architecture/decisions/0032-independent-deployment-decisions.md).

## Working tree

Task files: SQL 0027, Drizzle schema, contracts and tests, admissions service, upgrade fixture entry, ADR, runbook, status, backlog, build log, F25 review and this handoff. The pre-existing staged full-project review and its shared backlog/status hunks stay preserved and excluded. Use an isolated index, as the [build log](../build-log.md) records.

## Checks and evidence

`pnpm check` PASS/0 (365 unit cases/44 files). `pnpm test:db` PASS/0 (211 cases/7 files plus migration proofs). A targeted manual mutation run removed seven protections; two survived at first and gained real tests. Details and corrections are in the build log. No browser suite was run. `DEPLOYMENT_REVIEW_STALE` is defense in depth and is not exercised, because the reservation trigger refuses the change first.

## Decisions and blockers

A revocation is refused once a job exists, because it cannot recall work; stop latches own that. Decisions live at most five minutes, bounded by their request, which may be too short for a real interface and needs a renewal design then. A revoked or rejected review cannot be reconsidered without a future request generation.

The active GitHub work account gets HTTP 403 on push. Use the connected personal account per command; do not change the active account, because other sessions may depend on it. The VPS thread is separately blocked on owner inputs; see the [P4 handoff section](F25-bedrock-vps.md).

## Next action

A qualifier adapter cannot simply call `currentApproval`. Two prerequisites come first. The qualifier runs at `issue`, `fetch` and `permit`, but `currentApproval` denies once a job exists, so it needs a job-aware variant that binds the job's stored `approval_hash`. And `DeploymentJobs` runs in the gateway with no identity service by design (ADR 0025), while the remote authorizer covers one principal, so paired authority needs a two-principal remote proof. Absent sources must deny; a boolean test qualifier must never become production policy.

This work is parked: without real host, storage, game, identity and recovery sources the adapter can only deny. Delivery priorities rank backups above provisioning, so local work moves to CL-F2-03. Canonical HTTP/SDK decision routes can follow independently, using [ADR 0032](../../architecture/decisions/0032-independent-deployment-decisions.md). Installed entrypoints stay inventory-only.
