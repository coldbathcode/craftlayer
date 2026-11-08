# ADR 0037 — Knock to join: recording allowlist refusals as identities

Status: adopted for master plan step A4 (server plugin and node reader), 2026-11-08. The plugin compiles against the pinned Paper API and loads on a real local server; a real refusal has not yet been recorded by it, and nothing shows knocks in the dashboard yet.

## Context

A Bedrock player can only be allowed by their Xbox account number (XUID). Public gamertag lookups are unreliable: today one of three family members could not be resolved by any service, and the only way to learn the account was to watch the server log while they were refused. Parents should never have to do that.

## Decision

1. **A tiny server plugin records refusals.** `CraftLayerKnock` listens to the synchronous `PlayerLoginEvent` at monitor priority and, only when the result is `KICK_WHITELIST`, appends one JSON line to `plugins/CraftLayerKnock/knocks.jsonl`: time, name, account UUID, edition, and the XUID for Bedrock accounts (the low 64 bits of the Floodgate UUID). It never changes the login outcome, never records IP addresses, rate-limits to one line per account per minute, and rotates the file at 1 MiB.
2. **The node reads, the platform decides.** `parseKnocks` in the node's game-control library turns the file into "asking to join" entries: one per account, attempts counted, nothing older than 24 hours, malformed lines ignored, and the XUID derived from the UUID itself rather than trusted from text. Allowing a knock reuses the existing `allow` action with that exact XUID, so the player who knocked is the player who gets in.
3. **Built from the server's own API.** The plugin is compiled by `scripts/minecraft/build-knock-plugin.mjs` with the system JDK against the `libraries` directory of a booted pinned Paper server, with warnings as errors and no network or build framework. The jar is a build output, not committed; its SHA-256 is printed for the deployment record.

## Consequences

- Installing the plugin on the family server is a VPS change (copy the jar, restart once) that waits for A2 approval together with RCON.
- The dashboard's "asking to join" card (B2) and the agent request flow (C3) consume these entries.
- Proof that a real refusal is recorded will come from the first real knock on the VPS; until then the evidence is compile, load and unit tests.
