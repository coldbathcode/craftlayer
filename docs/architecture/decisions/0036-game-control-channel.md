# ADR 0036 — Private game control channel and typed actions

Status: adopted for master plan step A2 (library part), 2026-11-08. The library is built and tested locally against a real pinned Paper server; nothing is installed on the VPS and no API or UI calls it yet.

## Context

Every change to the family server so far (allowlist, settings, restarts) has been made by an engineer over SSH, and adding a Bedrock player needed a full restart because the server had no console. The plan needs a way for the node agent to perform a small set of game actions on a server it owns, quickly and safely, so the dashboard and approved AI agents can offer buttons such as **Allow**, **Kick** and **Back up now**.

## Decision

1. **RCON on a private network only.** The game server's RCON listener is enabled with a generated password held only by the node agent and bound to an internal Docker network shared with that agent. It is never published on the host, never reachable from the internet, and the password is never logged or returned. (A local test may publish it on loopback; production must not.)
2. **Typed actions, never console text.** `GameActions` exposes `players`, `allow`, `revoke`, `kick`, `say`, `saveAll`, `pauseSaving` and `stop`. Each verb is fixed in code and every argument is validated (player names `^\.?[A-Za-z0-9_]{1,16}$`, bounded messages without control or formatting characters, no leading `/`). Callers cannot pass arbitrary commands, and the RCON client itself refuses multi-line, control-character and oversized text.
3. **Bedrock identity is the XUID.** A Bedrock player is allowed by writing `{uuid, name}` to `whitelist.json` with the Floodgate UUID derived from the Xbox account number (`00000000-0000-0000-` plus the 64-bit XUID in hex), then `whitelist reload`. No public gamertag lookup is required, so the case that blocked a real player today cannot recur once the knock feature (A4) supplies the XUID. Java players still go through the server's own `whitelist add`, which uses Mojang's online lookup.
4. **Verify, don't trust the reply text.** `allow` and `revoke` report `ok` only if `whitelist list` afterwards shows the expected state; the reload is repeated a bounded number of times because the real server was observed answering "Reloaded the whitelist" while still listing the old file (a freshly renamed file lagged on a macOS Docker Desktop bind mount; a second reload two seconds later saw it). `saveAll` is `ok` only when the server says it saved. Results carry the server's own words as evidence. Floodgate's own `fwhitelist add <floodgate-uuid>` also works but records the name as "unknown", and `fwhitelist add <gamertag>` silently depends on the public lookup that failed for a real player today, so CraftLayer writes the file itself and keeps the gamertag as the label.
5. **Allowlist writes are atomic and compare-and-swap.** The file is rewritten through a temp file and rename, and only if it still matches what was read; a concurrent change aborts with `WHITELIST_CHANGED_MEANWHILE` instead of being overwritten.
6. **Graceful stop goes through the console.** `stop` asks the server to save and exit; the node's container lifecycle verbs remain the authority for forcing a container down.

## Consequences

- The node agent needs read/write access to the owned deployment's `whitelist.json`; it already owns that data directory for deployments it created. For the hand-deployed playtest server, enabling RCON and granting that path is a VPS change requiring approval (A2 proper).
- A3 wraps these actions in durable operations with permission checks in the API, domain service and node, idempotency keys and audit.
- The whitelist schema accepts non-RFC UUIDs on purpose; API contracts that carry Floodgate UUIDs must do the same.
