# Local node command execution boundary

Status: private execution library implemented through CL-F25-03 checkpoint I, including durable receipt recovery and journal v2. Later constrained-broker fixtures exercise actual disposable non-Minecraft Docker resources; installed agent/gateway entrypoints still accept enrollment/heartbeat/inventory only. No installed Minecraft mutation is enabled. [ADR 0020](../architecture/decisions/0020-node-execution-journal.md) defines decisions and limits.

`apps/minecraft-node/src/executor.ts` validates strict signed commands, target/key/policy/time binding and fresh online nonce-bound permits. The trusted authority port must reload canonical current operation/actor/approval/stop/node state; a callback that simply echoes a request is a test fake, not a production authorizer. The broker port must resolve only approved local policy/owned resources and call its guard before every physical verb. It must respect abort and still classify unknown daemon effects conservatively. Private controller and constrained broker implementations now exist and are exercised by disposable fixtures; see [deployment jobs](deployment-jobs.md) and [broker](node-broker.md). Installed entrypoints do not wire these ports, and production approval/storage/game/recovery qualification remains absent.

The executor stores prepared intent before dispatch intent, then signs only bounded hash-bound receipts. Lost acknowledgements, late callbacks, broker exceptions and post-dispatch revocation/stop/deadline become uncertain. They block subsequent work for that resource after process restart or credential rotation. Exact completed receipt replay still requires current authority; expiry does not grant execution or a cached authorization shortcut. Canonical lowercase UUIDs prevent alternative textual identities. Success requires non-null verified evidence; other receipt states cannot claim it.

Use a separate owner-private execution journal directory, not the existing heartbeat sequence directory. A process lock, tenant/node/control binding, fsynced atomic snapshots, stop generation, highest fence and policy/credential floors remain durable. A second process, missing/corrupt existing state, invalid permissions and clock rollback are refused. Initial limits are 128 receipts/resources and 512 KiB; admission halts at capacity. No automatic purge/archive or local stop-clear workflow exists; qualify those before production use.

## Checks

```bash
pnpm build:server
pnpm exec vitest run apps/minecraft-node/src/executor.test.ts
pnpm check
```

Tests use private temporary directories, generated signing keys, deterministic clocks and fake authority/broker ports. They cover scope/signature/time/schema denial, signed receipts, replay/current revocation, stale fences/foreign world bindings, nonce replay, uncertain acknowledgement/rotation, stop persistence, concurrent admission/close, wall/monotonic deadlines, hanging/late callbacks, corrupt/missing state and an actual child-process SIGKILL after dispatch intent. The child writes a simulated-effect marker only; it does not connect to Docker or a game. Test-only lock removal occurs after confirming that child is dead and retaining its dispatching intent.

## Recovery and rollback

Do not delete/reinitialize journals to clear stop, expired policy, capacity limits or uncertainty. On a crash, retain files/lock, prove the old process is dead and inspect exact command/deployment/fence and ownership evidence. Removing an orphaned lock after operator review must leave the execution state intact; unresolved work still cannot dispatch. The actual evidence-bound reconciliation/approval workflow is not implemented, so unresolved production recovery is not yet supported. Preserve worlds/backups and use the [preservation procedure](../operations/minecraft-preservation.md) before any future live write.

Application rollback can stop using the new library while retaining its journal. It must not rewind floors, reuse old credentials, clear a durable stop or undo world data by reverting an image. An abort is not proof that Docker cancelled an accepted effect. The existing inventory process has no import/dispatch path to this executor. Durable reservations/current authority, constrained broker and disposable scratch-host checks now have recorded evidence. Continue with real independent approval, storage/game/identity/recovery qualification and fail-closed private composition before enabling effects; remote/private PKI/MFA still blocks release.

The private broker now supports a verified `rolled_back` result for compensated provision failure; its signed receipt retains evidence and retires the resource binding. Verified broker no-dispatch leaves the binding available for a newer explicit command, with null receipt effect evidence. See [ownership ADR](../architecture/decisions/0023-node-broker-ownership.md). Unknown effects still block conflicting work. Optional private mTLS command routes are exercised by fixtures; the installed listener does not enable them.
