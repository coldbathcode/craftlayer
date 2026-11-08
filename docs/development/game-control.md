# Game control library (node agent)

Status: built and verified locally against a real pinned Paper server on 2026-11-08 (master plan [A2](../plan/A-live-connection.md), library part). Not installed on the VPS; no API, UI or MCP action calls it yet. Design: [ADR 0036](../architecture/decisions/0036-game-control-channel.md).

## What it is

`apps/minecraft-node/src/game-control/` gives the node agent a private, typed way to talk to a Minecraft server it owns:

- `openRcon({host, port, password})` — a small Source RCON client (the console protocol Minecraft servers speak) with timeouts, frame reassembly, bounded commands and no logging of the password.
- `GameActions` — fixed verbs: `players()`, `allow({edition:"java", name})` or `allow({edition:"bedrock", gamertag, xuid})`, `revoke(name)`, `kick(name, reason)`, `say(text)`, `saveAll()`, `pauseSaving(on)`, `stop()`. Every result returns `ok`, the server's exact reply as `evidence`, and parsed `detail`.
- `FileWhitelistStore` — atomic, compare-and-swap editing of `whitelist.json`, used for Bedrock players because their Floodgate UUIDs cannot be looked up by the server.
- `floodgateUuid(xuid)` / `floodgateName(gamertag)` — the identity rules Floodgate applies, checked against a UUID observed in the real server log.

## Knock to join (server plugin)

`infra/minecraft/plugins/craftlayer-knock` is a small Paper plugin that records allowlist refusals as one JSON line each (`plugins/CraftLayerKnock/knocks.jsonl`): time, name, account UUID, edition and the XUID for Bedrock accounts. It never records addresses, never changes the login result, rate-limits to one line per account per minute and rotates at 1 MiB. `parseKnocks` in the node library turns that file into "asking to join" entries (one per account, attempts counted, 24-hour expiry, XUID derived from the UUID). Design: [ADR 0037](../architecture/decisions/0037-knock-to-join.md).

Build it with the system JDK against a booted pinned server's own API jars, so it matches what runs:

```bash
node scripts/minecraft/build-knock-plugin.mjs <bundle>/data/libraries
# writes infra/minecraft/plugins/craftlayer-knock/dist/craftlayer-knock.jar and prints its SHA-256
```

The opt-in check below also builds it, installs it into the disposable server, restarts, and confirms it loads without errors. A real refusal needs a real client, so recording is proven on the family server once a real knock happens there.

## Backups

The same library carries the consistent backup archive (`createBackupArchive`, `verifyBackupArchive`, `restoreBackupArchive`); see the [backup runbook](backups.md) and [ADR 0039](../architecture/decisions/0039-backup-archive-consistency.md). The opt-in check below backs up the live disposable server and boots a second server from the restored files.

## Checks

```bash
pnpm exec vitest run apps/minecraft-node/src/game-control   # fake console and fake RCON server
CRAFTLAYER_ACCEPT_EULA=true pnpm test:game-control           # real pinned Paper boot, opt-in
```

The opt-in check prepares a fresh bundle with `pnpm minecraft:playtest:prepare`, enables RCON for the test on a random loopback port, boots a flat world, and runs every action: list players, allow a Bedrock identity by XUID, refuse an unknown Java name, kick an offline player, say, save, revoke, refuse a wrong password, graceful stop with exit code 0. It then removes only the containers and directory it created. It needs Docker, network access for the pinned download, and your explicit EULA acknowledgement through the environment variable; it never touches the VPS or an existing world.

## Limits

- Production RCON must stay on a private Docker network; publishing it on the host, even loopback, is for this local test only.
- Allowlist changes verify against `whitelist list` and reload up to four times; the real server once needed a second reload before it saw a freshly written file. An `ok: false` result means the server never confirmed, not that nothing happened: check the listing.
- Kicking a player who is not online returns the server's "Invalid name or UUID" and counts as a no-op (`wasOnline: false`).
- Bedrock `allow` needs the player's XUID. Today that comes from a manual lookup or the temporary join recorder; A4 turns refused joins into "asking to join" entries with the XUID attached.
- The current VPS playtest server has RCON disabled. Enabling it is an approved VPS change in A2.
