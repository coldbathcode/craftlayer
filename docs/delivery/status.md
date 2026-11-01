# Current delivery status

Last updated: 2026-11-01.

## Authorized scope

The user's next-steps request after Chapter 02 authorizes Chapter 03. Chapters 00–02 are accepted for advancement, not independent security certification. Chapter 04 requires authorization. Every coherent build step updates plans, commits/pushes origin main and verifies clean synchronization.

## Current checkpoint

- Chapters 00–02 implemented/verified; [provider review](../reviews/02-provider-gateway.md), hosted final CI 41292488668 passed at base `9c9981b`.
- Chapter 03: CL-03-01 through CL-03-03 verified (3/7).
- Latest evidence: Implemented BullMQ 6.5.3 Redis reference-only publication, PostgreSQL outbox leases/fenced acknowledgements, bounded fair active-tenant turns and missed-dispatch repair. Added atomic instance/org/user/project active-mission/agent and hourly runtime/tool quotas plus conservative allocated-storage reservations and scoped budget administration. Required dependency failure now propagates topologically; optional dependents skip. pnpm check passed 191 tests; pnpm test:db passed 65 database/API tests plus migration proofs with disposable authenticated Redis. Tests show fair turns, one concurrent admission under a one-mission cap, storage denial, publish-before-ack crash replay, queue loss repaired from DB and one fake durable result across 20 replays. Actual authenticated worker claims/results remain CL-03-04; no inference or real environment effects. Next: worker identity, fenced leases and bounded tool/model runtime.
- CL-03-04: in progress; server-authority checkpoint verified.
- Next: bounded model decision/repair and exact-action independent approvals.
- Read [Chapter 03](../chapters/03-fleet-engine.md), [ADR 0014](../architecture/decisions/0014-runtime-authority-and-recovery.md) and its runtime/data/security references before continuing.
- Main UI: http://127.0.0.1:3000/account. Preserve ignored credentials/volumes; existing account state is preserved. Tests use disposable installations only.
- Branch/remote: main → https://github.com/coldbathcode/craftlayer.git. See [build log](build-log.md) for exact task evidence.
- Chapters 04–11 unimplemented; no live/paid inference, public deployment, real mail or Cloud implementation authorized.

## Active smaller checkpoint

CL-03-04 server-authority checkpoint: registered org/environment-bound workers with hashed expiring tokens, protocol checks, atomic agent/task claims, fences, bounded lease/deadline heartbeat, canonical tool permits, verified result settlement and conservative uncertain holds. Worker RPC accepts bearer identity only; cookie sessions cannot authorize it. Service audits contain canonical worker/task IDs, never tokens or prompts. pnpm check passed 191 tests; pnpm test:db passed 69 database/API cases plus migration proofs, including one winner/result across 100 concurrent HTTP claims, queue tampering/foreign-world/protocol denial, stale/expired fences, revoked registration and initiating-session denial, non-dispatch retry and uncertain prepared-effect holds. Fixed retry publication so a recent previous-attempt hint cannot delay a due new attempt. The production worker process, model-plan validation and approval workflow remain in progress; CL-03-04 is not complete. Next: bounded worker process and model/approval integration.

Observed local setup status is now `required:false`; preserve the configured installation. No fixture owner was created there by this work. Hosted server-checkpoint CI 41312706290 failed on a missing optional BullMQ Redis driver; the active worker-process checkpoint pins the driver explicitly and requires fresh qualification.

## Latest process checkpoint

CL-03-04 worker-process checkpoint: replaced the foundation worker DB client with bearer-only API control, pinned ioredis 6.0.0 explicitly for BullMQ 6.5.3 and added protected enrollment/CLI transport configuration. Worker Compose receives no database/identity/provider credentials; optional file mount is read-only and owned by its non-root UID. Added monotonic deadline/watchdog, bounded HTTP, heartbeat cancellation and two concurrent reviewed simulation actions. pnpm check passed 196 tests; pnpm test:db passed 70 cases plus migration negatives; pnpm test:offline passed 196; pnpm stack:up and pnpm check:stack passed; local secret scan passed. pnpm test:runtime-stack passed CLI/API/actual-container-worker two-agent DAG and credential/log separation with its own disposable owner/volumes. Hosted CI 41312706290 had exposed an implicit optional ioredis dependency; the explicit production/dev pins fix the clean-install gap and the isolated Docker run qualifies it locally. Fresh hosted CI is still required. Main setup is now required:false and existing account state was preserved; no real-installation fixture owner was created. Model decision/approval flow remains unimplemented, so CL-03-04 is still in progress.
