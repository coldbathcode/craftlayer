# ADR 0022 — Fixed Docker policy and guarded Engine verbs

Status: adopted for local F2.5 development, 2026-11-02. Implements policy/I/O primitives; durable ownership runner and actual-host qualification remain separate checkpoints.

## Decision

Keep the broker inside the privileged node application, independent of API/web/general workers. Accept typed command references only. A trusted local catalog supplies an immutable approved deployment manifest; the operator policy pins allowed image digests/profiles, resource ceilings, tenant/node/policy revision and evidence references. Compile it to an in-process plan capability that cannot be reconstructed from JSON. Generate container/network/volume names from canonical immutable IDs and an operation-owned nonce. Never accept caller Docker options, environment, shell/entrypoint, mounts, paths, network mode or image URLs.

The first compiler emits numeric non-root user 10001, read-only root, all capabilities dropped, no-new-privileges, fixed CPU/memory/swap/PID limits, private namespaces, no automatic restart/removal, no published ports, bounded tmpfs and only the derived world volume at `/data`. Minecraft profile requires the fixed Family Survival resources plus identity/restore/EULA/quota evidence references. A separate explicit disposable non-Minecraft fixture profile uses only small tmpfs scratch, fixed Redis arguments, network none and no real world; it is not a public server template or readiness bypass.

Use fixed Engine API 1.50 Unix-socket methods: bounded inspect, approved digest pull, private bridge create, stopped container create, start, graceful stop, stopped-container removal retaining volumes, and empty-owned-network removal. No raw request interface, exec/shell/RCON, update, prune, kill, image/volume deletion or caller registry-auth passthrough exists. Every mutation invokes the fresh execution guard immediately before dispatch and respects cancellation; requests have absolute size/time bounds and never retry an unknown write. Already-accepted daemon effects remain uncertain after an abort.

Validate native runtime limit/seccomp support and image provenance. Before lifecycle/removal, compare expected IDs/nonce/tenant/deployment/world labels, image/configuration, user, commands/entrypoint/environment, mounts, network/private flags, limits and absence of public bindings. Project only IDs/booleans/config hashes, never environment/logs/host paths. Creation refuses **any** preexisting derived-name resource, even matching labels. Labels alone are not creation provenance: a durable ownership/intent runner must accompany these private helpers before exposing effects.

Persistent Minecraft creation additionally requires a real private world quota verifier and an existing correctly owned local-driver volume. No such production adapter exists; absent/incorrect quota refuses creation. No generic volume auto-creation or deletion method is provided. A future storage allocator must prove controlled root, world identity, actual hard quota and operation ownership; do not use a test fake as production evidence.

Stop uses explicit SIGTERM and `t=-1`; the daemon does not escalate to SIGKILL through this helper. The bounded command/request deadline can still expire while shutdown continues. That is uncertainty, not permission to force-kill, resume or release the world. Process state is not game readiness; F2 real access/save/backup/restore and effective host-network gates remain.

References: [Docker Engine API 1.50](https://docs.docker.com/reference/api/engine/version/v1.50/), [Docker stop timeout semantics](https://docs.docker.com/reference/cli/docker/container/stop/). API schema was read from the official downloadable OpenAPI YAML; runtime pins are unchanged.
