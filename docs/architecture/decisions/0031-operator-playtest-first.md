# ADR 0031 — Prioritize a playable operator-managed VPS test

Status: adopted for local preparation, 2026-11-04. Source: the user's request to get a fully playable server on their VPS as quickly as possible. This changes the immediate delivery sequence, not existing-world preservation or family/production release claims.

## Decision

Make the next observable milestone one separate Java Minecraft test world that the owner can join on the selected VPS. Prepare an operator-controlled Compose bundle now, inspect the actual target next, then present an exact deployment/recovery plan. Keep existing F2/F25/F3 work and automated provisioning contracts intact. Durable platform approval decisions are still necessary for platform-driven effects, but need not delay preparation of a manually operated test instance.

The initial default is Java-only Paper using the existing candidate's exact JAR checksum and Java image digest. The user's client choice is pending; Bedrock requires a separate pinned Geyser/Floodgate configuration and real admission/denial evidence, not an assumption that Java proves crossplay. The first game connection is through an SSH tunnel to a VPS loopback TCP port; no public game or administrative port is opened by the bundle. Candidate artifact integrity is not runtime, identity or security qualification.

Local `minecraft:playtest:prepare` creates a fresh private temporary bundle, never selects an existing output/world path, and cannot invoke Docker, SSH, firewall changes or the CraftLayer execution APIs. It downloads only pinned Paper with bounded hash verification; an incomplete download never receives the runnable filename. EULA remains false, whitelist defaults empty, OP list stays empty, online authentication and enforced allowlist stay enabled, and RCON/query/JMX/management listeners remain disabled. Container configuration uses a non-root UID/GID, separate relative data/runtime binds, read-only root/runtime, dropped capabilities, no-new-privileges, bounded CPU/RAM/process/tmp/log use, no Docker socket and no automatic restart.

The operator profile is not an approval/qualification adapter and must never be injected into the node broker as a bypass. All platform permission, independent approval, durable jobs, leases, tenant and node-command constraints remain unchanged. Preparing a bundle neither provisions a server through CraftLayer nor claims dashboard lifecycle support.

## Gates before actual VPS changes and play

1. Identify the exact SSH target/account and obtain the authorized read scope. Inspect existing containers, game/data mounts, actual versions, port use, memory/disk capacity, storage/quota support, firewall and recovery evidence without reading secrets into logs.
2. Produce the exact separate directory/project/world/port/UID/resource/storage/backup plan and rollback. The existing deployment remains in place. Verify a recoverable path for existing workloads before host writes. Choose a dedicated quota-controlled filesystem for new world data; view distance or world radius is not a disk quota.
3. Obtain explicit EULA acknowledgement and approval of that concrete host change. Use the player's actual online Java UUID/name; do not equate name lookup with authenticated web/game ownership.
4. Run an isolated boot, authenticated allowed/denied join, graceful shutdown, stopped-world backup/hash comparison and isolated restoration before claiming the tested milestone. Never restore over the original world or enable offline authentication to simplify testing.
5. Provide the connection instructions and verify the owner can play. Then adopt/observe the test server in CraftLayer and add narrowly scoped lifecycle/backup controls through the established domain/approval path.

VPS target, client/player details and EULA acceptance are pending at this checkpoint. No host login, EULA acceptance, game boot or server deployment has occurred. Daily encrypted/off-host backup policy, Bedrock compatibility, family acceptance and full automated provision/lifecycle remain separate unfinished requirements.

## Scope, evidence and rollback

This is CL-F25-03/P1 preparation within authorized local F2/F25/F3 capability work. It does not authorize Chapter 04, AI bots, purchases, a public dashboard, changes to the existing family world or unreviewed remote writes. Unit tests cover safety input/configuration and artifact refusal; real pinned-download and Compose validation are recorded separately from unexecuted game/host checks in the build log. No migration or existing product behavior changes. Application rollback removes only the new preparation command/source; prepared bundles and any eventual world data must be retained, not automatically deleted.
