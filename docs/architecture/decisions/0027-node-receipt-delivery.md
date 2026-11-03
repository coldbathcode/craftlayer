# ADR 0027 — Durable node receipt delivery without effect retries

Status: adopted for local CL-F25-03/I development, 2026-11-03. Extends ADRs 0020/0026; installed inventory main remains unchanged.

## Decision

Compose signed discovery, exact command fetch, the existing executor/broker and receipt settlement in a private sequential `NodeCommandRunner`. Drain at most eight retained signed receipts before polling for new work. Upload acknowledgement must match the exact local receipt/command/resource/scope/state under pinned TLS; persist its receipt digest with file/directory sync before continuing. A lost acknowledgement or restart repeats only idempotent metadata delivery. It never refetches/executes the command as a receipt retry, even after command expiry or human revocation. Poll at most one job per tick, retain all existing current-permit/stop/fence/uncertainty gates and generic outcome logging. Abort before execution prevents that attempt; abort during execution allows the executor to finish its bounded durable outcome, retaining the receipt for a later upload. Graceful shutdown does not clear or automatically latch emergency stop.

Add local journal schema v2 with nullable acknowledged receipt hash. New readers strictly accept v1 and atomically rewrite v2 during open, preserving command bytes, signed receipts, resource/world/fence bindings, stop generation and credential/policy floors. Unknown/corrupt schema remains denied. Storage bounds remain 128 commands/512 KiB; acknowledgement does not delete history or free slots. An older binary cannot read v2: rollback must retain files and use a forward compatible fix, never reset/recreate the journal to downgrade.

Receipt delivery is metadata only and remains available during durable local stop. A stopped/disabled executor, any unresolved resource or a pending receipt backlog blocks new polling/execution. Unknown native intent with no receipt cannot be resumed through this runner. Delivery of an uncertain receipt never clears the unresolved resource. Acknowledgement with controller state uncertain is compatible with matching signed receipt evidence, but grants no reconciliation permission. Pending receipts from an earlier credential/policy floor require operator recovery; do not silently drop them during rotation. Normal rotation should drain receipts first.

## Evidence and limits

New deterministic real-file tests cover acknowledgement loss/reopen/expiry/revocation with one effect, evidence delivery during durable stop, rejected contradictory acknowledgements, retained native uncertainty and v1 upgrade preservation. Actual disposable DB/remote-authority/mTLS/Docker composition drops a response after controller receipt commit, reopens the node executor and delivers the same receipt once more without another resource creation.

No exactly-once physical guarantee, automatic unknown-intent recovery, archival, production qualifier or installed execution mode. Real approval/host quota/Minecraft identity/backup/restore and separate production permission remain required. Revert runner wiring only; retain v2 journals, signed receipts and all controller/world allocations.
