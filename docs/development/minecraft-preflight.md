# Minecraft read-only preflight

CL-F0-01 implements local inventory only. It never starts/stops containers, executes container commands, writes configuration/worlds, changes firewalls, creates backups or contacts RCON/SSH/remote Docker. No production inspection has been run. [Preservation permissions](../operations/minecraft-preservation.md) still apply; use only approved local scopes.

## Commands

From the repository with its pinned Node/pnpm dependencies installed:

```bash
scripts/preflight.sh --help
pnpm test:preflight
```

No arguments prints help without collecting anything. Tests use synthetic evidence, a temporary Unix socket and a recording runner, not a real Docker daemon. To process an operator-protected synthetic/captured evidence object offline:

```bash
scripts/preflight.sh --fixture /absolute/protected/evidence.json
```

The internal fixture shape is `Evidence` in `scripts/minecraft/preflight.ts`: container name, selected data root (or null), bounded named read results (`status`, `text`), selected configuration-file results, optional numeric disk and backup metadata. Raw fixtures can contain secrets and must remain outside Git/artifacts. Never publish a Docker inspect dump as a fixture. Unit fixtures are generated synthetic data in memory.

Local collection, **only after authorization for that host/read scope**, is explicit:

```bash
scripts/preflight.sh --local --container SELECTED_CONTAINER \
  --docker-socket /absolute/local/docker.sock \
  --data-root /absolute/discovered/data \
  --compose /absolute/discovered/compose.yaml \
  --backup-root /absolute/approved/backup-directory
```

Arguments are examples, not actual Contabo values or authorization. There is no remote target mode. The socket must be an existing local Unix socket, not a symlink/context/TCP/SSH fallback; select its actual path. Docker commands use explicit `--host unix://…`, fixed inspect/list/version arguments, known installed binary locations and a restricted subprocess environment excluding inherited Docker transport settings. Firewall reads are fixed `nft --json list ruleset` and `iptables-save` without sudo or automatic privilege elevation. Missing tools/permissions become unknown/unavailable evidence. No raw child stderr is printed.

The selected `/data` mount must exactly match the canonical selected data root before properties can be trusted. Selected files are read with size limits, no-follow/nonblocking file opens and symlink checks; no world traversal occurs in CL-F0-01. Commands have a three-second timeout and 256 KiB output cap; selected text files have the same cap. Backup directory scanning is bounded to 10,000 entries, top-level regular-file metadata only, with no archive opening or deletion. Missing/racing/oversized files remain unknown. Installed binaries and host administrators are trusted; path checks do not isolate a compromised host.

## Report semantics and limits

JSON includes schema version, observation time, container/image ID, stopped/running state, resource limits, fingerprinted mounts/networks/config, published-port classifications, selected literal authentication/allowlist settings, player-record counts without names, backup candidate age/count and disk capacity. Raw environment, Compose, plugin configurations, credentials, player names and host paths are excluded. Opaque SHA-256 fingerprints are for local comparison, not secret encryption or public artifacts; protect reports as inventory metadata.

A false online-mode/allowlist setting, non-loopback RCON publication or privileged/host-network container produces a critical finding. Unparseable/escaped/duplicate properties are not interpreted as secure defaults. Geyser/Floodgate configuration presence/fingerprints are observations only: installed plugin/game/Java versions, identity linking/first-time resolution and actual allowlist behavior remain unverified. Operator identities/volume ownership/heap and effective host/edge firewall review still need approved inspection. No game-client/network probes run.

Exit 0 means inventory was produced; it is **not** security/readiness success. Invalid input/arguments return 2 with a generic redacted error. Reports always set `family_ready:false` and `production_verified:false`. Local port bindings/firewall fingerprints cannot prove public reachability. Backup filenames/mtime cannot prove consistency, encryption, policy compliance or recovery. F0-02 adds preservation manifests and a disposable byte-recovery rehearsal; real game restore and identity/client qualification remain F2 gates.

## Verification

`pnpm test:preflight` exercises stopped/running preservation, canary redaction in malformed/error paths, custom-port IPv4/IPv6 RCON detection, wrong-container/data denial, read-only command construction, missing socket/tool evidence, bounded/symlink/traversal rejection and CLI argument handling. Full `pnpm check` includes these tests and strict checking of `scripts/minecraft/**/*.ts`. See [build log](../delivery/build-log.md) for executed results; no production result is implied.

Implementation references: [Docker inspect](https://docs.docker.com/reference/cli/docker/inspect/), [Node 22.23.3 child processes](https://nodejs.org/download/release/v22.23.3/docs/api/child_process.html) and [file operations](https://nodejs.org/download/release/v22.23.3/docs/api/fs.html). These informed bounded no-shell reads; actual installed server/plugin compatibility is a later qualification.
