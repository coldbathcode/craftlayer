# Constrained Docker broker development

Status: CL-F25-02 checkpoint C implements private policy and Engine I/O primitives, with a recording Unix Engine fixture. It is not wired to the agent/gateway/API/SDK/MCP; no real Docker or Minecraft effect is claimed by this checkpoint. [ADR 0022](../architecture/decisions/0022-constrained-engine-policy.md), [execution](node-execution.md) and [reservations](node-reservations.md) describe the required composition.

`BrokerPolicy` validates a trusted catalog manifest against exact command tenant/node/deployment/server/world/reservation/plan/template/policy references and local approved image/resource/profile ceilings. It emits immutable generated names/labels and an unforgeable in-process plan. A serialized/copied plan is not a capability. Caller manifests with arbitrary image tags, environment, mount/path, shell, privileged or network fields are rejected. Approval/qualification records must come from the real private controller/catalog, not model/client assertions.

`BrokerEngine` has fixed API 1.50 routes only, Unix socket only, no raw request escape, absolute byte/time limits and no write retries. Images are pulled by the approved digest only; local image provenance/config hashes are rechecked. Creation emits fixed non-root/read-only/cap-drop/NNP/private-resource settings with no published ports or auto-restart/removal. Lifecycle/removal refuses ownership or configuration drift, including hidden stopped-container port bindings, commands/entrypoint/environment, host mounts, privileges, limits or namespaces. Inspected raw secrets/paths/logs are not returned. Missing runtime CPU/RAM/swap/PID/seccomp support is unavailable rather than assumed safe.

Minecraft persistent storage must have identity/restore/EULA/quota references and an actual quota verifier for the exact owned local volume. Without a real verifier it fails before container creation. No volume creation/deletion, arbitrary host binds, exec, kill, prune or Docker passthrough is implemented. World allocation and real hard quota remain a dedicated host adapter/release gate. The explicit disposable profile is non-Minecraft, scratch-only tmpfs, network none and fixed Redis startup; it cannot prove persistent world recovery or family readiness and is not selectable through a public template.

Private Engine helpers alone do not prove resources were newly created. The next durable broker runner must record absence/creation intent, immutable returned IDs and nonce before allowing further actions/removal. Never wire these helpers directly to a public action or adopt a resource merely because labels match. Remove only proven new stopped runtime resources, with `force=false&v=false`; retain all world storage. Network deletion requires exact ownership, isolation and zero attached endpoints. Image/volume deletion has no method.

## Checks and limits

```bash
pnpm exec vitest run apps/minecraft-node/src/broker-engine.test.ts
pnpm check
```

Fourteen recording-engine cases cover fixed bodies/routes/guards, pinned/unknown images and resource ceilings, scope/JSON-capability/unknown-field denial, command/entrypoint/env/privilege/mount/public-port drift, preexisting/running/attached resource refusal, unavailable quota, runtime limits/pull failure, cancellation and lost write acknowledgement without retry/adoption. These are deterministic protocol/policy checks, not a real Docker/Minecraft/host-network/restore qualification. The next checkpoint adds durable operation-owned recovery and a disposable real non-Minecraft Engine exercise.

Graceful stop sends SIGTERM with no daemon kill timeout; local request/job deadline still bounds waiting and must yield uncertainty if unverified. Full save coordination, safe image lifecycle, client identity, persistent quotas, effective firewall/private control, backups and isolated restoration remain required before family/VPS release. No RCON or Docker port may be public. Socket-capable node compromise remains potential host compromise; the broker is not host isolation.
