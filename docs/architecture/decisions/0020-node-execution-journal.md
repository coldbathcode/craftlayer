# ADR 0020 — Signed node execution and conservative uncertainty

Status: adopted for local F2.5 development, 2026-11-02. Builds on [ADR 0016](0016-node-provisioning-boundary.md) and [ADR 0019](0019-private-node-trust.md). This is not production or game-runtime qualification.

## Decision

Keep the inventory protocol and executable entrypoint inventory-only. Implement the mutable execution boundary as a separate private library with injected current-authority and constrained-broker ports. No HTTP/CLI/MCP or environment switch exposes it yet. Local execution policy defaults disabled and binds control key, distinct node key, canonical organization/project/node IDs, credential generation and policy revision/hash. Jobs permit only provision/start/stop/restart/rollback references; no shell, Docker/RCON parameters, host paths, arbitrary images, environment variables or caller-supplied approval boolean.

Control-signed jobs bind exact operation/attempt/fence, deployment/server/world/reservation IDs, plan/template/authorization/approval hashes, stop generation and a maximum 30s window. Mutable jobs reject future-issued timestamps. Every broker verb must call the guard immediately before dispatch. Guard obtains a fresh nonce-bound, control-signed current permit with at most 5s lifetime, exact job hash/target/fence/generation/policy/authority and no cached-permit replay. Wall-clock rollback and monotonic deadline expiry fail closed. Authority denial/partition prevents new dispatch; no SQL transaction spans host I/O.

Persist prepared intent, dispatch intent, highest resource fence, immutable server/world/deployment bindings, credential/policy floors, durable local stop and signed receipts in an owner-private bounded journal before and after effects. Reuse the heartbeat journal's exclusive-process lock; use a separate directory. File and containing-directory sync follow atomic snapshot replacement. Existing missing/corrupt/symlink/foreign state is refused, never reset. An unclean process exit leaves its lock for operator review. Rotation/reopen retains fences, unresolved work and stop; no automatic stop clear exists.

Exact completed replay returns the retained signed receipt only after current authority revalidation and within the original job lifetime. Higher-fence conflicting work cannot pass an unresolved intent. A known pre-dispatch denial produces `not_dispatched`; any exception/timeout/stop/authority loss after dispatch intent produces `uncertain`, even if the adapter may have done nothing. Only explicit verified broker evidence and final guard yield success. An uncertain resource cannot be retried, reprovisioned or implicitly rolled back. Reconciliation/retirement requires a later implemented evidence-bound workflow; editing/deleting the journal is not recovery.

## Limits and consequences

A Docker operation already accepted by the daemon may complete after a lease expires, request aborts or credentials are revoked. Guards prevent new dispatch, not retroactive cancellation or physical exactly-once execution. Retain uncertainty and reservations; never implicitly power off a game to reconcile an agent connection. A compromised socket-capable agent still compromises its host.

The first bounded snapshot implementation retains up to 128 command receipts/resources and at most 512 KiB; it refuses further admission at capacity rather than silently deleting replay/fence evidence. Retention/archival and disk durability/host-filesystem qualification remain release gates. Current-authority transport, durable control-plane jobs/approval/stop integration, actual broker/quotas and real identity/backup/restore remain separate gates. Fake ports and a real process-kill drill prove local ordering/restart refusal, not Docker or Minecraft postconditions.

Reference: [Node 22 filesystem API](https://nodejs.org/docs/latest-v22.x/api/fs.html). Runtime remains pinned to 22.23.3; consulted patch documentation does not change the pin or imply power-loss guarantees on an unqualified filesystem.
