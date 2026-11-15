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

- **Online sign-in.** The fixture is offline. Signing in with the owner’s Microsoft account (device code) is proven in G4, on the worker.
- **The family server has no bridge yet.** Installing ViaVersion and ViaBackwards there is a production change: a restart, a verified backup first, and the owner's approval (decision 13). Until then the AI player can join only the test world. Geyser and Floodgate loaded beside the bridge in every run, but no Bedrock client joined the test world.
- Long sessions, combat, crafting, chests and mobs (peaceful difficulty) are G5.

## G3 — Records, worker hosts and spending (2026-11-15)

[ADR 0053](../architecture/decisions/0053-ai-player-records-and-hosts.md). Package `@craftlayer/ai-players`, migration 0040. Owner routes need `ai_player:manage` (org admins) and the usual session, origin and CSRF headers. Worker host routes need `Authorization: Bearer clah_…` only.

| Route under `/api/v1` | What it does |
| --- | --- |
| `GET, POST /ai-players` | List; create (name, project, persona, rules, connection and model, worker host, game address and protocol, Minecraft username and sign-in mode, instructor identities, daily/total limits in micro-USD, calls per hour) |
| `GET, PATCH, DELETE /ai-players/:id` | Read with tasks, status and spend; change named fields (`expected_version`); delete when stopped |
| `PUT /ai-players/:id/tasks` | Replace the master tasks (title, goal, priority 1–100, condition `always`/`owner_online`/`day`/`night`) |
| `POST /ai-players/:id/start`, `/stop`, `/clear-stop` | Start (needs a host and no latch); Stop latches; clearing never starts |
| `POST /ai-players/:id/instructions` | Send an instruction (dashboard); MCP instructions arrive the same way |
| `GET /ai-players/:id/transcript?after=` | Newest 200 messages after a sequence number |
| `GET, POST /ai-players/:id/memories`, `DELETE …/memories/:memory` | Read, add or forget memories |
| `GET, POST /ai-player-hosts`, `POST /ai-player-hosts/:id/revoke` | Worker hosts; the token is shown once on create |
| `GET /ai-player-host/assignments` | Host: its players, their tasks and whether each should run |
| `POST /ai-player-host/players/:id/status`, `/pending`, `/messages`, `/owner-chat`, `/think`; `GET, POST …/memories` | Host: report, take instructions, post replies, record owner chat, ask for a model call, read and add memories |

Money is integer micro-USD: $1.00 is `"1000000"`. The owner decided on $1 a day and $10 in total to start (`"1000000"` and `"10000000"`). Each model call reserves its worst case first. The player is charged the observed tokens at the snapshot price, while the provider ledger books the worst case for the hourly limits, so give hourly budgets headroom.

Evidence: `pnpm test:db` 255/255, including 7 AI player cases: permissions and children; one-time host tokens and assignment scoping; worst-case reservation, daily and total limits, release of an undispatched failure; calls per hour; stop latch blocking calls and instructions; once-only instruction hand-over; memory caps and owner edits; status staleness; host revocation. One case is a paid call through the real provider gateway: it charged 1500 µUSD from observed usage while the ledger booked its 6000 reservation, and the ledger's user scope is the owning adult. A contract test guards against defaults being applied on update.
