# Constrained Docker broker development

Status: CL-F25-02 checkpoints C/D implement private policy, Engine I/O and a durable ownership runner, with recording Unix Engine fixtures. It is not wired to the agent/gateway/API/SDK/MCP; checkpoint E adds real disposable non-Minecraft Docker evidence only. [ADR 0022](../architecture/decisions/0022-constrained-engine-policy.md), [execution](node-execution.md) and [reservations](node-reservations.md) describe the required composition.

`BrokerPolicy` validates a trusted catalog manifest against exact command tenant/node/deployment/server/world/reservation/plan/template/policy references and local approved image/resource/profile ceilings. It emits immutable generated names/labels and an unforgeable in-process plan. A serialized/copied plan is not a capability. Caller manifests with arbitrary image tags, environment, mount/path, shell, privileged or network fields are rejected. Approval/qualification records must come from the real private controller/catalog, not model/client assertions.

`BrokerEngine` has fixed API 1.50 routes only, Unix socket only, no raw request escape, absolute byte/time limits and no write retries. Images are pulled by the approved digest only; local image provenance/config hashes are rechecked. Creation emits fixed non-root/read-only/cap-drop/NNP/private-resource settings with no published ports or auto-restart/removal. Lifecycle/removal refuses ownership or configuration drift, including hidden stopped-container port bindings, commands/entrypoint/environment, host mounts, privileges, limits or namespaces. Inspected raw secrets/paths/logs are not returned. Missing runtime CPU/RAM/swap/PID/seccomp support is unavailable rather than assumed safe.

Minecraft persistent storage must have identity/restore/EULA/quota references and an actual quota verifier for the exact owned local volume. Without a real verifier it fails before container creation. No volume creation/deletion, arbitrary host binds, exec, kill, prune or Docker passthrough is implemented. World allocation and real hard quota remain a dedicated host adapter/release gate. The explicit disposable profile is non-Minecraft, scratch-only tmpfs, network none and fixed Redis startup; it cannot prove persistent world recovery or family readiness and is not selectable through a public template.

Private Engine helpers alone do not prove resources were newly created. The durable broker runner now records absence/creation intent, immutable returned IDs and nonce before allowing further actions/removal. Never wire these helpers directly to a public action or adopt a resource merely because labels match. Remove only proven new stopped runtime resources, with `force=false&v=false`; retain all world storage. Network deletion requires exact ownership, isolation and zero attached endpoints. Image/volume deletion has no method.

## Checks and limits

```bash
pnpm exec vitest run apps/minecraft-node/src/broker-engine.test.ts
pnpm check
```

Fifteen recording-engine cases cover fixed bodies/routes/guards, pinned/unknown images and resource ceilings, scope/JSON-capability/unknown-field denial, command/entrypoint/env/privilege/mount/public-port drift, preexisting/running/attached resource refusal, unavailable quota, runtime limits/pull failure, cancellation and lost write acknowledgement without retry/adoption. These are deterministic protocol/policy checks, not a real Docker/Minecraft/host-network/restore qualification. Thirteen additional runner cases cover lifecycle/replay/fences, preexisting/cross-manifest refusal, lost creation acknowledgement across rotation/reopen, known-resource rollback, running removal refusal, guards/concurrency, missing/corrupt/public/symlink state, truthful receipts and a real child-process SIGKILL against the recording Engine. Checkpoint E supplies the real non-Minecraft Engine exercise below.

Graceful stop sends SIGTERM with no daemon kill timeout; local request/job deadline still bounds waiting and must yield uncertainty if unverified. Full save coordination, safe image lifecycle, client identity, persistent quotas, effective firewall/private control, backups and isolated restoration remain required before family/VPS release. No RCON or Docker port may be public. Socket-capable node compromise remains potential host compromise; the broker is not host isolation.

## Durable runner and retained uncertainty

[ADR 0023](../architecture/decisions/0023-node-broker-ownership.md) defines the separate private `broker.json` journal (128 deployments/1 MiB) and process lock. Preserve it alongside the execution journal. The runner resolves an operator-private manifest, records ownership nonce/manifest hash/server/world/fence, then fsyncs each native intent and acknowledged ID. A pending intent blocks replay, new commands and rollback across restart/rotation. There is no automatic adopt/retry, force-clear, archival or resolution interface. Removing a dead process lock after explicit operator review does not resolve unknown effects; never delete/reset the ownership file.

Provision creates a stopped container and checks exact closed/private configuration; process creation is not game readiness. Reopen never starts it. Restart on a stopped container is `not_dispatched`; explicit start remains possible with a newer signed authorized command. Runtime rollback removes only exact acknowledged new stopped resources and an empty owned network. Volumes/backups/images and reservations remain retained and charged; the broker has no release/deletion port for those. Verified provision compensation produces a signed `rolled_back` receipt and retires the immutable deployment, never a success that invites starting it. Failed/unknown compensation remains pending.

Default production storage qualification is still unavailable. No helper/runner is wired to agent, API, dashboard or MCP. Real admission, current approval/stop transport, controller jobs, archival/reconciliation, effective host firewall/quota and Minecraft identity/backup/restore remain required. Recording Engine/process-kill evidence remains distinct from checkpoint E real Docker evidence and does not establish any Minecraft result.

## Repeatable real local Docker fixture

```bash
pnpm test:node:broker
```

Requires the pinned Redis image from `infra/images.lock.json` already cached locally (the prototype/DB fixtures use it). The launcher pins a local Unix Docker context and refuses SSH/TCP endpoints before any write. It never reads `.env`, pulls a game image, accepts EULA, connects to a VPS, publishes a port or mounts/creates a persistent world. Do not redirect it to production or substitute a game profile. It generates private in-memory test identities and explicitly fake current authority/approval; those are never production adapters.

The actual Engine 1.50 exercise creates generated stopped non-root/read-only/cap-drop/NNP/CPU/RAM/PID-limited Redis fixtures, starts them through the signed executor, waits boundedly for Redis PING and verifies a 1 MiB tmpfs limit with a static harness-only scratch write. There is no product exec port. It checks replay/revocation, restart, external manual stop across journal reopen, explicit restart no-dispatch/start, exact runtime rollback, a preexisting matching-name sentinel, actual compensation receipt and an injected lost network acknowledgement. The latter leaves the product journal unresolved and blocks rollback/retry; the harness separately captures exact native returned IDs to dispose its own known temporary resources. That disposal is not product reconciliation.

Successful cleanup rechecks absence and removes only those exact captured fixture IDs/empty networks; no label scans, prune, volume/image deletion or `force` are used. Original containers/running states and volume names are checked unchanged. The harness keeps a private temporary ownership ledger until disposal; failures preserve journals for review rather than resetting safety state. A killed test can leave temporary fixtures: inspect the recorded exact IDs and nonce/current ownership before any manual cleanup, never generalize this procedure to real worlds.

Verified on macOS arm64/Docker 28.2.2 (API 1.50), Node 22.23.3 and the committed Redis digest. Scratch tmpfs enforcement is not persistent Minecraft world quota qualification, and Redis process health is not Minecraft readiness. Persistent storage allocator/quota, actual identity/backup/restore, independent approval/current authority transport, durable controller jobs, effective remote networking and production install remain open.
