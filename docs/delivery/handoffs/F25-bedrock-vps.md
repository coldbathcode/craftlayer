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

## P3 continuation — current stopping point

P2 published as `7661beb`, with actual origin/main equality verified. Initial push using the active work GitHub account failed HTTP 403; a per-command existing personal GitHub credential succeeded without changing global credentials. The pre-existing review remains staged. A patch-byte equality assertion failed because new status lines shifted diff metadata; working-file/index inspection confirmed the original review and its staged changes remained intact.

P3 fixed native WebRTC startup by permitting execution only on crossplay's bounded temporary filesystem. Java-only defaults remain unchanged. Real ARM64 and Linux AMD64 local smoke instances booted Paper and builtin signaling; Java status returned zero players. The first noexec boot remains a failed Bedrock result. An independent restoration decrypted the original off-host archive, verified all original files, then booted the copied world in a separate local AMD64 container with tightened access/network/metrics settings and no public ports. Original VPS before/after manifests still match. Actual client admission and full player-state restoration remain unverified.

The existing prototype database/accounts were preserved and brought up locally; a new real VPS environment and read-only server registration were created via authenticated API with durable operation/audit records. Direct API observation and browser page navigation show observed offline and disabled allowlisting. A browser text-wait attempt timed out and is not reported as passed. Screenshot and operation receipts are private. Automatic provisioning remains disabled; this is observed existing-server metadata, not a new platform deployment.

New bundle and read-only preflight are staged in a uniquely named owner directory on the VPS, with EULA acceptance receipt and original pinned hashes. The preflight exited 2: artifact/EULA/existing-container/mount checks pass, but the new quota filesystem and firewall capture do not exist. The owner has an outstanding async request to run the sudo storage script. Do not bypass sudo with Docker privilege. Gamertags and exact iPad version are still missing. No completion email was sent because the server is not ready.

Continue by checking the protected local operator workspace and mounted `/srv/craftlayer-playtest-<deployment-id>/data`, reviewing its firewall capture, and verifying the underlying root-owned loop image and marker before copying the empty seed into that new mounted filesystem. Then boot only the owned separate Compose project, retain private game bindings until access/network qualification, and perform real iPad join trials. The original Minecraft container must remain stopped. Preserve the encrypted archive/key and source manifests; private operational files are outside Git.

Final P3 full check passes 363 cases plus lint/types/docs; no SQL/API/UI source changed. Disposable local game fixtures are stopped (SIGTERM/143, no OOM), the plaintext restore seed is removed and encrypted recovery retained. The local dashboard stays available. Only the pre-existing review/shared hunks should remain dirty after publication.

## P4 continuation — running closed instance and remaining owner gates

The owner ran the storage script. The private preflight then passed all ten checks. A Codex session seeded the empty world and started only the owned Compose project at 20:13 UTC, then asked the owner for gamertags and client version and ended its turn. A Claude Code session independently verified the running state read-only and added the dashboard registration. Do not run both agents against this host at once; check for a live session before acting. Another project's agent also operates on this VPS, so container recreation outside this deployment is not ours and must not be touched.

Do not read the private preflight's `server_started` field as evidence: it is a hardcoded `false`. It reported false while the server was running. Inspect Docker directly.

Verified: Java status on VPS loopback (Paper 26.3, protocol 777, 0/5 players, secure chat enforced); expected container limits/labels/mounts; loopback-only bindings; external TCP unreachable on both game ports; EULA true by owner receipt; empty allowlist and OP list; original container exited with unchanged identity. Spark's async-profiler warning is expected because world storage is noexec, and is non-blocking.

False lead to avoid: the container shows a random high UDP socket and TCP listener. Those are Docker's embedded DNS on `127.0.0.11`, not Geyser, so they are not a port mismatch. The pinned Geyser configuration states `webrtc-port: 0` means "use `port`", so the generated value is correct. No UDP socket is bound on the game port while idle; this may be per-session binding and only a real join can settle it.

The host firewall does not itself restrict game ports. Loopback binding is the effective control, so changing a binding to a public address exposes that port immediately; provider edge filtering is unverified. Exposure needs explicit owner approval and must include only the TCP signaling and UDP game port, never Java admin or management listeners.

Next, once the owner supplies gamertags, client version and exposure approval: write those into a new approved operator record, set the public `advertise-addresses`, add allowlisted Floodgate identities through the official procedure, restart only this instance and run real iPad allowed and denied joins. Then graceful stop, new-world backup and isolated restore. Send the completion email only after a real join succeeds. Refresh the dashboard with the private `observe-playtest.mjs`; it refuses if bindings stop being loopback-only, so it must be deliberately changed alongside approved exposure.
