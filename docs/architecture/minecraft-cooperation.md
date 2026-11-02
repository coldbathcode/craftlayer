# Minecraft world safety and cooperative build design

Status: proposed example specification for Chapters 04/06. Server, game protocol, Mineflayer and pathfinder versions/authentication must be tested together before claiming support.

## Progressive demonstration levels

1. Adapter proof: one bot joins private world, moves, performs/validates one safe action, stops and reconnects safely.
2. Prepared-world cooperation: two bots use known accessible resources/shared chest to complete the shelter below. This isolates scheduling/cooperation from survival uncertainty.
3. Survival gathering extension: scouts locate renewable/basic resources within allowed region; gatherers collect the bill of materials before building. Record separate completion/time results.
4. Village extension: multiple validated blueprints plus role specialization after the small-build benchmark passes. No promise of a large army on small hardware.

Each level has its own versioned preset, material assumptions and outcome verifier. Never present a chest preloaded by an adult as autonomous survival gathering.

## Shelter v1 fixture

Coordinate frame: anchor `(x0,y0,z0)`, fixed orientation initially, approved rectangular work region, flat nonhazardous ground and loaded/reachable chunks. Validate terrain before dispatch. Orientation support later transforms relative coordinates deterministically and updates verifier expectations.

| Component | Relative block positions | Required material / count |
| --- | --- | --- |
| Floor | x=0..4, z=0..4, y=0 | Planks, 25 |
| Lower wall ring | Perimeter of 5×5, y=1, except doorway at x=2,z=0 | Planks, 15 |
| Upper wall ring | Perimeter of 5×5, y=2, same doorway gap | Planks, 15 |
| Roof | x=0..4, z=0..4, y=3 | Planks, 25 |
| Door | x=2,z=0,y=1..2 | One door item; verify both halves and facing |
| Interior | x=1..3,z=1..3,y=1..2 | Air except explicitly permitted decorative items |

Base bill: 80 planks + 1 door item. If crafting the door from scratch yields excess items, report inventory outputs accurately rather than assuming one-item recipe yields. Decorative lighting is optional and excluded from v1 required outcome. Survival logs-to-planks/door recipe mapping must use the actual pinned game recipes, not a guessed conversion.

Verifier checks exact block types/coordinates, unobstructed interior/entry and required door state from world observations. Required preconditions include protected structures/player property outside the region. If the fixture is invalid, block before digging. Do not terraform arbitrary terrain to force success.

## Two-bot task DAG

Survey/precondition validation → material availability → supply reservation → stage inventory → floor → wall sections → door → roof → independent verification. Required walls/roof depend on safe placement/access, not simply maximum concurrency. Courier and Builder are initial roles; Quartermaster/Commander may be deterministic scheduler functions rather than separate model-driven bots.

The first bot reserves/transports batches from an adult-provided shared chest. The second reserves/places cells, verifying each result. Later a third bot gathers or surveys. Limit inventory transfer batches and avoid trapping agents inside completed sections. Maintain safe standing/path clearance and a planned exit route.

## Role responsibilities

| Role | Typed work | Limits |
| --- | --- | --- |
| Scout | Survey resource/terrain positions and hazards | Allowed radius and chunk/time budgets |
| Miner | Gather allowlisted blocks/materials | Allowed dig volume; no protected/player structures |
| Lumberjack | Harvest approved trees | Bounded area and replanting policy where supported |
| Courier | Transfer reserved inventory to/from shared chest | Reserved quantity, validated chest identity, no arbitrary containers |
| Builder | Place deterministic blueprint cells | Approved cells/items and lease/fence |
| Guard | Defend against allowlisted hostile mobs | No players/PvP, bounded range, no pursuit outside region |
| Quartermaster | Material availability and allocations | Blackboard/resource authority only |
| Commander | Propose bounded DAG and role allocation | No direct authority/approval/budget bypass |

## Resource and cell reservations

Reservation identity includes environment/world instance ID, dimension, coordinate/container slot or resource quantity, mission/task, owner and expiry/fence. Lock resources in stable order to avoid deadlocks. Partial transfers record source/destination inventory before/after; interrupted action reconciles observed quantities and marks uncertain if provenance is ambiguous.

A placement uses expected precondition, desired block, stable action ID and postcondition observation. If the desired block already exists, verify it and mark satisfied. If a conflicting block exists, do not destroy it without separate permitted plan/policy. DB fencing cannot force the Minecraft server to reject a stale client: single active sessions, watchdog disconnects and world preconditions are essential.

## Failure handling

No path: bounded alternative path then block with location. Missing chunk: load deadline then block. Hunger/death: safe recovery policy; never unlimited respawn/reconnect. Lost inventory: recalculate shortages and reservations. Player edits: re-survey affected region, preserve protected property and require adult review for destructive repair. Chest locked/missing: block; do not loot another container. Provider unavailable: deterministic task may continue only within existing authorized plan/lease; no unapproved new plan.

## World access and child mode

World is private and explicitly assigned; bot names/auth tokens managed by adults. Server allowlist/PvP settings are defense in depth alongside adapter policy. Game chat, sign text and item labels are untrusted observations. Child presets cannot enable operator commands, unrestricted chat, player attacks or arbitrary blueprint JSON.

Offline authentication, if used for an isolated local fixture, is not a production default and requires explicit network isolation. If legitimate online bot authentication requires extra account setup, document it before promising a turnkey experience.

## Benchmark evidence

For each run record game/protocol/adapter versions, world seed/snapshot, anchor/region, hardware, bots/roles, provider mode, initial inventory, elapsed time, verified blocks, failures/retries, transfer receipts, CPU/RAM, token/tool counts and stop latency. Store only synthetic/private-safe traces in the repo; worlds and login secrets stay ignored. Three consecutive prepared-world runs must pass the Chapter 06 gate; survival and scaling results are separately labeled.

## Family management precedes new bot work

This document covers in-game agents only. [Management architecture](minecraft-management.md) and [F track](../delivery/minecraft-track.md) cover preservation/adoption/access/backups/provisioning before Chapter 04. Reuse approved version fixtures, world registry and dashboard later without giving bots RCON/Docker/node or web-owner credentials. A child/bot Stop All stops assigned bot actions; server lifecycle needs a distinct adult operation. Production online authentication/strict allowlist is mandatory; any isolated offline bot fixture is never a production deployment path.
