# CraftLayer handoff — Bedrock VPS preparation and preservation

**Date:** 2026-11-07. **Base:** main `cd82573`. **Task:** CL-F25-03/P2. **Authorization:** owner requests continued VPS server delivery and completion email, confirms iPad clients, explicitly accepts Minecraft EULA and agrees to playable operator instance followed by observation. Existing worlds and unrelated services must be preserved. Automatic platform provision must not bypass missing qualification/independent approval.

## Current state

Crossplay preparation is implemented using the existing pinned candidate, default-deny player access, loopback Java plus Bedrock TCP/UDP, builtin NetherNet, no linking/STUN/metrics or EULA autoacceptance. No platform mutation route is changed. Exact-source Geyser configuration and official Floodgate whitelist documentation were consulted. The pinned manifest remains unqualified pending actual iPad/game evidence.

Authorized VPS inspection found a stopped existing Paper container, Geyser/Floodgate, disabled empty allowlist, online authentication and no discovered Minecraft backup. The stopped deployment has now been read into an AES-256-GCM off-host recovery archive. Authenticated decryption and isolated extraction matched all 217 files / 297,024,634 bytes. The post-capture manifest exactly matches the original, including container stopped-state and source metadata. No existing file/container was changed. A game restore boot remains unexecuted. Private archive, key, source manifests and operation scripts are in the owner's protected local `craftlayer-vps-20261107-*` directory outside the repository; never commit or email those files.

A narrowly scoped operator script has been uploaded to the owner's home on the confirmed VPS. It creates a fresh separate 8 GiB ext4 loop filesystem and reads nftables rules without changing firewall policy. Sudo requires the owner's password; an async request asks them to execute the exact script through SSH. Do not use Docker privilege to obtain root. The proposed new server is separate from `/opt/minecraft-java`, with unique deployment ID, non-root UID/GID, 2 CPUs/3 GiB RAM, no public admin ports and retained data on rollback. No new server has yet been booted at this checkpoint.

## Working tree

Task files: playtest implementation/tests, chapter/runbook/architecture/ADR/status/backlog/risk/log/handoff. Pre-existing staged full-project review and shared backlog/status hunks remain preserved/excluded. No credentials, host address, account names, raw logs or world/archive contents are committed.

## Checks and evidence

`pnpm exec vitest run tests/unit/minecraft-playtest.test.ts` PASS/0 (6 tests). `pnpm check` PASS/0 (lint/boundaries, strict server/test/web types, 363 unit cases/43 files, docs). `pnpm minecraft:identity:prepare` PASS/0 for pinned official artifacts; `pnpm minecraft:playtest:prepare <private-crossplay-input>` PASS/0 for all three actual downloads. SHA-256 checks are enforced by preparation. No new database/browser result is claimed for the additive script. Existing source before/after equality and isolated file restore PASS. Shell syntax for the one-time storage script PASS. New game boot/client/restore and privileged firewall inspection remain pending.

## Decisions and next action

Continue within authorization: verify owner-completed mount and firewall capture, prepare exact new-instance Compose mapping/EULA acceptance, boot with empty allowlist and record real readiness. Preserve existing stopped container. Require actual Xbox gamertags/client version before granting game access; general assent cannot identify accounts. Verify stop/backup/isolated game restoration, then real read-only platform observation. Only send a completion email when the delivered state is honestly complete; report any manual gates explicitly. Independent durable platform decisions and installed qualification remain unfinished.
