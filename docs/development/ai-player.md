# AI player harness

Master plan [Milestone G](../plan/G-ai-player.md); decisions in [ADR 0051](../architecture/decisions/0051-ai-player-harness.md). This runbook grows with each G step.

## G1 — Compatibility record (2026-11-15)

**Result: the bot can play on the family server's exact version, with three measures.** Pins live in [`infra/minecraft/ai-player-compat.lock.json`](../../infra/minecraft/ai-player-compat.lock.json).

| Layer | Pin | Why |
| --- | --- | --- |
| Server | Paper 26.3 build 237 with Geyser 2.12.1 and Floodgate 2.2.5 (the family server's [candidate profile](../../infra/minecraft/identity-candidate.lock.json)) | Same server the AI player will join |
| Version bridge (server plugins) | ViaVersion 5.12.2 and ViaBackwards 5.12.2, SHA-256 pinned | Mineflayer's newest tested version is 26.1 and minecraft-data 3.119.0 has no 26.3 data. The bot speaks 26.1; ViaBackwards translates. Upstream 26.2/26.3 support is in open pull requests (minecraft-data #1345, node-minecraft-protocol #1553, mineflayer #4213) |
| Bot library | Mineflayer at official commit `5a252e6d258882b042e60e21c37d552cdf3b3380` (master, 2026-10-25), mineflayer-pathfinder 2.4.5, minecraft-data 3.119.0 | Released 4.39.0 never sends `tick_end`; 1.21.2+ servers then reject movement (on 26.3 behind the bridge: an immediate `invalid_player_movement` kick). Master has the fix (#4137, #4162). Move back to a release once one includes it |

Two fixes live in the body code (`apps/ai-player/src/body/`):

1. **Tick-end shim** (`protocol.ts`): closes the client tick between two position-bearing packets, the rule of upstream PR #4201. Without it, a teleport reply and a physics update in one tick make the server pull the bot back.
2. **Server hitbox width** (`body.ts`): the game's player half-width is `(double) 0.6F / 2 = 0.30000001192092896`, but the physics library uses `0.3`. Flush against a block, every jump was corrected (over 1,100 corrections a minute near trees; issue #3911). Setting `playerHalfWidth` to the float value removed every correction.

A **correction guard** (`correction-guard.ts`) still watches for a pull-back loop during moves and reports `stuck` rather than pushing forever.

### Evidence

`CRAFTLAYER_ACCEPT_EULA=true pnpm test:ai-player-world` boots a disposable local copy of the pinned server, adds the pinned bridge, and runs the real body. The copy is loopback only, offline mode because it is an isolated fixture, seed `craftlayer-ai-player-1`. The body spawns, chats (and reads the echo), walks four 6-block legs with pathfinding and digging allowed, digs a block, picks up the drop and places it elsewhere. Then the check removes everything it created.

| Run (2026-11-15, Docker on the owner's Mac) | Spawned on | Moves reached | Server corrections | Dig / collect / place |
| --- | --- | --- | --- | --- |
| 1 | grass block | 4/4 | 1 | grass → dirt collected → placed |
| 2 | grass block | 4/4 | 1 | same |
| 3 | oak leaves (tree canopy) | 4/4 | 1 | same |

The single correction is the server's spawn teleport. Before the hitbox fix, the same check reached 4 of 12 moves. `AI_PLAYER_NATIVE_SERVER=1` swaps in Paper 26.1.2 without the bridge, to separate bot faults from bridge faults; that is how the hitbox fault was shown to be the bot's.

### What this does not prove

- **Online sign-in.** The fixture is offline. Signing in with the owner's Microsoft account (device code) is proven in G3/G4.
- **The family server has no bridge yet.** Installing ViaVersion and ViaBackwards there is a production change: a restart, a verified backup first, and the owner's approval (decision 13). Until then the AI player can join only the test world. Geyser and Floodgate loaded beside the bridge in every run, but no Bedrock client joined the test world.
- Long sessions, combat, crafting, chests and mobs (peaceful difficulty) are G5.
