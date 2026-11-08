# Playable VPS test — operator preparation

The immediate goal is a separate Minecraft server you can actually join on your VPS, followed by CraftLayer observation and management. This checkpoint prepares its files; **it has not deployed or booted a server**. The automatic CraftLayer provision route remains disabled. See [ADR 0031](../architecture/decisions/0031-operator-playtest-first.md).

## Crossplay preparation

The owner confirmed iPad/Bedrock clients. A private input containing `{"edition":"crossplay","port":25585,"bedrock_port":19133}` now prepares Paper plus pinned Geyser/Floodgate. Java remains the default when `edition` is omitted. The generated bundle still never deploys or accepts EULA. Crossplay uses builtin NetherNet signaling on loopback TCP and UDP with matching internal/external ports, Floodgate authentication, disabled account linking/metrics, and an empty allowlist. The candidate's broader Bedrock protocol list is not proof that a particular iPad version or transport works. Confirm the exact client version and real authenticated admission/denial before opening family access.

Ordinary SSH TCP forwarding does not carry the Bedrock UDP game session. Public/private game addressing, signaling advertisement and effective firewall must be qualified for the actual host before external play. Do not enable offline authentication or temporarily disable allowlisting to discover identities. Use the [official Floodgate whitelist procedure](https://geysermc.org/wiki/floodgate/features/) after the owner identifies the actual accounts, then verify authenticated allowed/denied joins.

Operational progress and private evidence locations are recorded in the [P2 handoff](../delivery/handoffs/F25-bedrock-vps.md); the platform's automatic provision route remains disabled.

## Prepare the exact Java candidate

```bash
pnpm minecraft:playtest:prepare
```

The command fetches only the Paper JAR pinned in `infra/minecraft/identity-candidate.lock.json`, checks its SHA-256 and creates a new private temporary directory. It prints that directory and deployment ID. It never modifies an existing directory, starts Docker, connects to the VPS, accepts EULA or opens a public port. Failed downloads retain `.part` evidence without a runnable JAR. Files stay outside Git.

Contents: `compose.json`, private `manifest.json`, `artifact.sha256`, `runtime/paper.jar`, `data/server.properties`, `data/eula.txt`, `data/whitelist.json`, `data/ops.json` and `README.txt`. Each invocation creates a distinct project/world. Do not use repeated preparation as a way to reset an existing test world.

An optional private JSON input file supplies `player: {name, uuid}`, numeric non-root `uid`/`gid`, and a game port from 1024 through 65535:

```bash
pnpm minecraft:playtest:prepare /absolute/private/playtest-input.json
```

Use the real online Java account UUID and name agreed with the owner. The tool validates their shape only; it does not prove account ownership, perform authenticated identity resolution or grant access through CraftLayer. Without player input the allowlist is empty and nobody can join. Never send Minecraft credentials or SSH private keys in chat or commit input/bundle files.

Defaults: Paper Java version from the existing lockfile, Java 25 digest-pinned runtime, Survival, five players, 2 GiB Java heap, 3 GiB container RAM/no additional swap, two CPUs, non-root UID/GID 1000, and loopback TCP 25575 forwarded to game port 25565. Actual target capacity, UID/GID and port availability must be inspected. A dedicated quota-controlled data filesystem remains a host deployment prerequisite; the bundle does not allocate or qualify one.

## Security and readiness

Online authentication, secure profiles and the allowlist are enabled. OP list is empty. RCON, query, JMX and the Minecraft management listener are disabled. Root filesystem and runtime artifact mount are read-only; only the separate data directory and bounded temporary directory are writable. No Docker socket, host networking, privileged mode or automatic restart is used. Compose refuses to create missing bind directories. The selected non-root container user must have correct ownership/access on the new data/runtime paths after an approved transfer. No chmod/chown of an existing world is allowed.

**EULA is false.** Read the [Minecraft EULA](https://www.minecraft.net/en-us/eula) and explicitly acknowledge it before a test boot. No acceptance command is executed by preparation. See [Paper requirements/startup](https://docs.papermc.io/paper/getting-started/), [server properties](https://docs.papermc.io/paper/reference/server-properties/) and [Compose service settings](https://docs.docker.com/reference/compose-file/services/) for the reviewed primary references. The locked candidate remains unqualified until actual tests run.

## Next deployment steps

1. Identify the VPS SSH host/account and Java/Bedrock client requirement. Inspect the authorized host read-only using the existing [preflight](minecraft-preflight.md) approach. Inventory the existing deployment, free resources/ports, network exposure, storage quotas and recovery evidence.
2. Prepare the exact new deployment/storage/backup plan with rollback and obtain approval for those host writes. Keep current containers, ports and worlds intact. Initial port binding stays loopback; an SSH tunnel carries the Java connection. Bedrock UDP is not supported by this Java-only bundle or an ordinary TCP SSH tunnel.
3. With EULA accepted and a resolved player allowlist, run the isolated test, verify authenticated allowed/denied access and graceful stop, create a consistent stopped-world backup and restore to a different isolated directory/instance. Hash verification and an actual restored boot are both required; file existence alone is not a backup test.
4. Hand over the tested address/tunnel instructions and confirm the owner can play. Then wire real read-only observation into the dashboard and continue typed lifecycle/backup integration. No production/family-ready claim follows from a successful artifact download or Compose parse.

Do not run broad Docker cleanup, `down --volumes`, force removal, existing-world import, offline mode, public RCON or global firewall replacement. Rollback must stop/remove only the new operation-owned runtime resources and retain the new world and its backups.

## Native networking and current operational evidence

Crossplay requires native WebRTC libraries. Docker mounts tmpfs with `noexec` unless explicitly overridden, even when only `rw,nosuid,nodev` is written. The crossplay bundle therefore uses `exec` on the bounded 256 MiB temporary mount; world storage can retain `noexec`. Java-only behavior remains unchanged. Paper's ready log alone is insufficient: verify Geyser's builtin signaling starts without native-loader errors, then perform authenticated Bedrock admission/denial from an actual supported client. A listener or HTTP 404 is not a successful game join.

Local ARM64 and Linux AMD64 smoke boots and an isolated restored-world boot/status query passed during P3. The copied original data was byte-verified before isolated access/network/metrics overrides; the original VPS source manifests remain unchanged. The separate VPS bundle is only staged until bounded storage and effective network evidence are verified. The real existing stopped server now has read-only registration in the local dashboard; full backup/client qualification remains unverified in its projection.

## Live instance state

As of P5 the owner approved exposure: the Bedrock signaling TCP and game UDP port are public, Java stays on loopback, and the allowlist holds Floodgate identities for named accounts. Real admission and denial remain unverified. Before that approval, game ports were loopback-only and the allowlist was empty. `advertise-addresses` must then name the public address, because clients receive it for the WebRTC session; the generated loopback value is correct only for private operation. In the pinned Geyser, `webrtc-port: 0` means the configured `port` is reused. A random high socket inside the container is Docker's embedded DNS on `127.0.0.11`, not a game listener. See the [P4 handoff section](../delivery/handoffs/F25-bedrock-vps.md).
