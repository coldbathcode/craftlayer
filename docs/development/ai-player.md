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
- **The family server got the bridge on 2026-11-15** (decision 13, owner-approved). The server was stopped for about 1 min 40 s with nobody online. A cold copy of the whole data directory was verified file by file (235 files) and also encrypted to the owner's key and checked on the owner's Mac. Then the two pinned plugins were added and the server restarted cleanly, with no new listeners. Rollback: stop, remove the two jars, start. Geyser and Floodgate loaded beside the bridge in every run, but no Bedrock client joined the test world.
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

## G4–G8 — The worker, brain, dashboard and MCP tools (2026-11-15)

[ADR 0054](../architecture/decisions/0054-ai-player-worker-and-agents.md). The worker is `apps/ai-player`. The dashboard screen is **AI players** in the family app (`/home#/ai-players`, adults with `ai_player:manage`). The MCP tools are `list_ai_players`, `get_ai_player_conversation`, `instruct_ai_player` and `stop_ai_player`, for agent tokens that also carry `ai_player:instruct`.

### Set up and run an AI player

1. **Connect a model.** The operator first declares the service in the protected provider policy file: an Ollama endpoint, OpenRouter models, Kong AI Gateway, or OpenAI, Gemini or Anthropic directly ([providers runbook](providers-and-budgets.md#openai-compatible-endpoints-kong-ai-gateway)). Then an adult opens **AI players → Model services**, picks the service, pastes its key and presses **Connect**; the card refreshes the models. Only tool-capable models are offered. For paid models, the adult also sets **Allow paid models, up to this much an hour**, which writes the policy and the hourly budgets. The instance file's `allow_paid` and cap still have to allow it.
2. **Add the computer that runs it.** In **AI players → Computers that run AI players**, add one and copy its key; it is shown once. On that computer:

   ```sh
   install -m 600 /dev/null ~/.craftlayer/ai-player-host.token   # then paste the key into it
   pnpm --filter @craftlayer/ai-player build
   CRAFTLAYER_API_URL=https://<your CraftLayer address> \
   CRAFTLAYER_AI_PLAYER_TOKEN_FILE=$HOME/.craftlayer/ai-player-host.token \
   CRAFTLAYER_AI_PLAYER_STATE_DIR=$HOME/.craftlayer/ai-player-state \
   node apps/ai-player/dist/main.js
   ```

   The worker refuses a token file that others can read.
3. **Create the AI player.** Fill in:
   - its name, personality, the model, and which computer runs it;
   - how it signs in: your Microsoft account (decision 8), or offline for a private test world;
   - its Minecraft name and the server address the worker can reach;
   - your in-game names, which are the only voices it takes instructions from;
   - its limits ($1/day and $10 total to start, decision 9);
   - master tasks, if you want it to work on its own (decision 12).
4. **Start it.** With Microsoft sign-in, the card shows a code to enter at Microsoft's sign-in page the first time; the worker keeps the session afterwards. It joins as your account, so play from your iPad or another account while it is on. If you join on Java with the same account, it leaves and waits for you to press Start again.
5. **Talk to it** in the dashboard's Talk tab, in the game ("Pip, follow me", or a whisper), or from Claude with an agent token that has `ai_player:instruct`.
6. **Stop** is on its card, in Claude (`stop_ai_player`), or by stopping the worker program. Stop latches: it starts again only when an adult clears the stop and presses Start.

The family server has had the ViaVersion/ViaBackwards bridge since 2026-11-15 (decision 13).

### Evidence (G10, local)

`CRAFTLAYER_ACCEPT_EULA=true pnpm test:ai-player-e2e` runs a disposable database, the real API services (auth, provider gateway, AI players), the pinned Paper 26.3 test world with the bridge, the real worker controller and a local Ollama model (`gemma4:latest`, eligible because its thinking can be turned off). Instructions go through the owner API.

| Run 2026-11-15 | Result |
| --- | --- |
| "Look around and tell me in one sentence what you can see." | `look_around`, 12 s |
| "Please collect 3 logs from the nearest tree." | `collect_blocks` → `oak_log x3`, 35 s |
| "Remember that the place where you are standing right now is called home base." | `remember` → place memory with position, 10 s |
| "Craft some planks from your logs." | `craft` → `oak_planks x8`, 55 s |
| Stop | left the game in 1 s |

17 model calls, 42,917 input and 406 output tokens, $0. The first run found two integration bugs, now fixed. The API's browser Origin/CSRF check blocked the worker's POSTs, so worker routes are now bearer-only like `/api/v1/worker/`. The brain also declared an input bound below the router's byte count, so every call was refused; the bound is now computed the same way and kept under 16,000.

A second run on 2026-11-15 added a real second Java client ("the owner", offline test account) that instructs the player in game chat, and passed 6/6:

| Run 2026-11-15 (second) | Result |
| --- | --- |
| look, collect 3 logs, remember, craft planks | 12 s, 30 s, 7 s, 13 s |
| Owner in game: "Pip, please say hello to me in the chat." | recorded as a game instruction; the player answered in chat, 9 s |
| Owner whispers "come to me" | recorded; the player walked to within 4 blocks, 23 s |
| Stop | 1 s; 13 calls, 30,672 in / 298 out tokens, $0 |

That run also found a quality fault: gemma4 answered the hello by writing `say(text="Hi OwnerTester! 👋")` as text, and the player chatted it literally. The brain now runs such a text-written call as the real call and never says call-shaped text ([ADR 0055](../architecture/decisions/0055-ai-player-g10-readiness.md)). A third run showed a `fetch failed` event in every scenario. The API's 5 s idle-socket cut was killing model calls slower than 5 s; the `think` route now keeps its socket for 75 s. Run 4, after both fixes: PASS 6/6 with no failure events (look 8 s, collect 3 logs 39 s, remember 12 s, craft planks 14 s, hello in game 10 s, "come to me" 18 s, Stop 1 s, $0). Small local models vary from run to run; the report lists each scenario's decisions, replies and events so a failure shows its cause.

### Paid-model runs

The same check runs against a paid model, capped at $1 for the whole run (the player's daily limit, the instance cap and the hourly budgets are all $1):

```sh
install -m 600 /dev/null ~/.craftlayer/openrouter.key   # paste the key into it
CRAFTLAYER_ACCEPT_EULA=true AI_PLAYER_E2E_PROVIDER=openrouter \
  AI_PLAYER_E2E_MODEL=google/gemini-3.1-flash-lite \
  AI_PLAYER_E2E_SECRET_FILE=~/.craftlayer/openrouter.key pnpm test:ai-player-e2e

# Kong AI Gateway, or OpenAI / Gemini / Anthropic directly: one endpoint declaration in a file
CRAFTLAYER_ACCEPT_EULA=true AI_PLAYER_E2E_PROVIDER=endpoint \
  AI_PLAYER_E2E_ENDPOINT_FILE=kong.json AI_PLAYER_E2E_MODEL=<model id in that file> \
  AI_PLAYER_E2E_SECRET_FILE=~/.craftlayer/kong.key pnpm test:ai-player-e2e
```

Not yet run: these need the owner's keys.

### On the VPS

`infra/compose/ai-player.yml` runs the worker beside the stack ([ADR 0055](../architecture/decisions/0055-ai-player-g10-readiness.md)). It is not on the game-control network. It reaches the family server through the host's published Java port: in the AI player's settings, use server address `host.docker.internal` and port `25566`. `.env` needs `CRAFTLAYER_AI_PLAYER_SECRET_DIR` (folder holding `host.token`, 0700, file 0600) and `CRAFTLAYER_AI_PLAYER_STATE_DIR` (0700). The worker restarts until the token file exists.

Not yet proven: a paid model through OpenRouter, Kong or a direct provider; Microsoft sign-in; long sessions; a supervised session on the family server.

