# ADR 0032 — Independent deployment decisions

Status: adopted for authorized local CL-F25-03 checkpoint K2, 2026-11-07. Durable review evidence only; no execution, qualification or production authorization.

## Decision

Add private `DeploymentAdmissions` methods `decideApproval`, `revokeApproval`, `approvalDecision` and `currentApproval`, with SQL 0027. A reviewer names one review request, the exact `review_hash` they saw and `approved` or `rejected`. Everything else is server-derived. Clients cannot supply reviewer, qualification, enablement, grant or expiry values.

**Asymmetric authority.** Approval widens a path toward execution, so it requires both adults to be current. It uses the paired `guardIndependentExecutions` with the original sealed node and provision grants plus fresh reviewer `approval:decide`, `node:deploy` and `server:provision` grants. The original binding, canonical reviewed plan, node and credential versions, and stop digest must all still match. Rejection and revocation only remove a path, so they need one current adult with `approval:decide`, and remain available during an emergency stop and after the requester's session ends. A stop must never prevent an adult from withdrawing approval.

**Independence.** The reviewer must be a different adult user from the requester. A second session for the same user does not count. Service checks, the paired guard and the SQL trigger each refuse self-review. The requester may still revoke an existing approval, because withdrawal is not self-approval.

**One decision per review.** SQL uniqueness and the scoped transaction lock keep a single decision per request, including under an approve/reject race. Same-key replay returns the saved decision; the same key with a different decision conflicts, and a different key receives `DEPLOYMENT_ALREADY_DECIDED`. A revoked approval cannot be reconsidered. A new review needs an explicit future request generation, which is not implemented.

**Evidence, not authority.** Decisions, revocations and the reference-only outbox are immutable rows with forced RLS and SELECT/INSERT-only runtime grants. State is derived, never updated: `approved`, `rejected`, `revoked` or `expired`. `execution_enabled` is constrained to false and qualification is always `unverified`. Projections omit reviewer, session and grant material. An immutable `decision_hash` gives later composition a stable value to bind as `approval_hash`.

**Revalidation before use.** `currentApproval` is for trusted composition. It reruns the paired guard over the sealed grants, rechecks revocation, reviewer identity, issued work, binding, plan, stop state and the minimum authority deadline, then returns evidence. It creates nothing and is not yet called by `DeploymentJobs`, so `DEPLOYMENT_UNQUALIFIED` still denies a missing qualifier even with a valid approval.

**Issued work.** Decisions and revocations are refused once a job exists for the intent. A revocation cannot recall issued work; stop latches own that. Refusing avoids recording a withdrawal that implies an effect it cannot have.

The request projection now derives `decided` and exposes `decision_id`, so a reader is not told a decided review is still awaiting review.

## Limits and sequencing

No HTTP, SDK, MCP, UI, worker or installed path is added. Decisions do not replace the independent approval evidence required by reservation dispatch admission, and test allocations still use explicit fake admission. `DEPLOYMENT_REVIEW_STALE` is defense in depth: the reservation transition trigger already refuses changes to an allocated plan through the runtime role, so that branch is not exercised by tests. The guarantee that is tested is the SQL refusal.

Decision lifetime never exceeds its request, at most five minutes. That is deliberately short and may need an explicit renewal design once a real interface exists. Revalidation narrows, but does not remove, the gap between a check and later use; identity locks do not freeze time or make effects atomic.

Next: a qualifier adapter that consumes `currentApproval` alongside real host, storage, game, identity and recovery evidence, then canonical HTTP/SDK decision routes.

## Evidence and rollback

Contract and real disposable database tests cover the behaviour above; exact results and the guard mutation run are in the build log. No real game, host or client evidence is implied.

SQL 0027 is additive. An application rollback may retain the new tables and history, because older code ignores them. Do not drop decisions or revocations, rewind stop or credential versions, or release allocations to retry. Production migration remains separately authorized.
