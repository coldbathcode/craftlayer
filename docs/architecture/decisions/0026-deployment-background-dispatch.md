# ADR 0026 — Bounded deployment dispatch and denial-only expiry

Status: adopted for local CL-F25-03/G development, 2026-11-03. Extends ADRs 0024–0025; no production effect activation.

## Decision

Use the immutable PostgreSQL authority outbox as the durable work source. A private `DeploymentDispatcher` accepts strict operator-configured organization/project/node/credential placement, scans at most eight unexpired unissued authority references per tick, and calls the existing sealed-authority issuer for each. Scope IDs are selectors, not authority: canonical registered placement is checked, and issuance still validates original current adult/session/dual permissions, stop epochs, node/key/policy, expiry and real qualification. No browser or arbitrary queue payload can invoke this worker.

A rotating UUID keyset cursor advances past blocked records and wraps when the bounded page is exhausted. Cursor state is only a fairness hint; restart begins another scan. Immutable outbox plus the unique intent/authority job link makes duplicate delivery and acknowledgement loss safe without marking events consumed. Concurrent scanners may perform redundant qualification reads, but commit only one command/audit/outbox and never extend its lease. Rechecking unissued metadata is distinct from retrying a physical command. Unavailable qualification and authority deny; unexpected failures stop the current tick. No transaction spans remote identity/qualification I/O. A cancellable one-second loop runs ticks sequentially, reports only generic outcomes and observes cancellation between bounded operations. Installed entrypoints do not activate it yet.

Expiry is a separate denial-only action. A bounded scoped sweep locks overdue issued jobs, validates the retained command against this controller signing identity and atomically records uncertainty, audit/outbox and retained reservation accounting. It requires canonical placement/credential history, even after node rotation/revocation; current actor authority, stop unlatching or host freshness cannot be prerequisites for denying an expired command. This private controller capability cannot sign, dispatch, renew, release allocations or clear uncertainty. Late signed success remains evidence inside uncertainty. Ordinary human settlement keeps its current permission checks.

## Limits and recovery

No physical retry/takeover, exactly-once claim, external queue requirement, production qualifier or new schema is introduced. Empty/expired authority is historical metadata; allocations persist pending separately implemented evidence-bound reconciliation. Large backlogs may wait multiple ticks; scans are bounded by eight references, existing admission rate limits and the 120-second authority window. Rotation/restart does not remint authority. A new controller key cannot settle signatures it does not own; retain history for explicit recovery rather than rewriting ownership.

Next add authenticated outbound node discovery of issued references, then installed private composition and qualified approval/storage/game/recovery sources. Revert the worker code while retaining outbox/jobs/allocations; no game/world rollback applies.
