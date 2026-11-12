# Hosting the dashboard on the VPS (master plan A1)

Status: deployed on 2026-11-08 at commit `ca524ec` as Compose project `craftlayer` under `/home/oli/craftlayer`: postgres, redis, api, worker and web healthy, migrations through 0032 applied, web listening on `127.0.0.1:3000` only (checked from outside: public port 3000 closed). Not yet reachable by the owner: HTTPS certificates and `tailscale serve` are pending, and the owner account has not been created. Nothing here opens a public port: the dashboard is reachable only on the family's Tailscale network, over HTTPS.

## Shape

- The same Compose stack as local development (postgres, redis, migrate, api, worker, web) runs as its own project on the VPS, with the web edge published on `127.0.0.1:3000` only.
- `tailscale serve` on the host terminates HTTPS with a certificate for the machine's tailnet name and proxies to that loopback port. No firewall change, no public listener.
- `CRAFTLAYER_PUBLIC_URL` is the tailnet HTTPS address, so cookies are `Secure` and the Origin check matches. `CRAFTLAYER_REQUIRE_MFA=true`, so every adult must enrol an authenticator at first sign-in.
- The dashboard's own database gets a nightly `pg_dump` kept on the VPS and pulled to the owner's Mac with the world backups (D2).
- Memory limits stay as in Compose (postgres 512 MB, web 512 MB, api/worker 256 MB each, redis 128 MB) so the dashboard cannot starve the game server, which keeps its 3 GB.

## Owner steps (need your password or your Tailscale account)

1. On the VPS: `curl -fsSL https://tailscale.com/install.sh | sh` then `sudo tailscale up`. *(Done 2026-11-08: the VPS is `vmi2954874.taile167a3.ts.net`, `100.114.62.124`.)*
2. In the Tailscale admin console, DNS tab: enable **MagicDNS** and **HTTPS Certificates**. Install the Tailscale app on your phone, iPad and Mac and sign in with the same account.
3. When asked, run the one `sudo tailscale serve --bg https / http://127.0.0.1:3000` command on the VPS so the dashboard answers at `https://vmi2954874.taile167a3.ts.net`.

## Agent steps (approved VPS writes, each recorded in the private operator record)

1. *(Done.)* Clone the repository on the VPS under the owner's home, build the images there (8 CPUs, 24 GB RAM) and create `.env` with generated secrets, the tailnet public URL and `CRAFTLAYER_REQUIRE_MFA=true`.
2. *(Done.)* Start the stack with `docker compose up -d --wait`; confirm only `127.0.0.1:3000` is listening and that the public interface shows no new port.
3. Bootstrap the owner account through the tailnet URL (the setup token is printed on the host only), enrol two-factor, and register the existing playtest server read-only, as the local prototype did.
4. Verify from a phone off the home network: HTTPS certificate for the tailnet name, sign-in requires a code, the server page loads. Record the evidence.
5. Then A2: enrol the node agent on the VPS against this stack and enable the private RCON channel.

## Server helper (master plan A2)

Status 2026-11-12: stack updated to the dispatch build ([ADR 0044](../architecture/decisions/0044-server-action-dispatch.md)); the helper waits for the owner's approval; private RCON is staged, not enabled.

1. *(Done.)* `.env` carries `CRAFTLAYER_NODE_CREDENTIAL_DAYS`, `CRAFTLAYER_NODE_ACTIONS=enabled`, `CRAFTLAYER_GAME_DATA_DIR` and the `infra/compose/game-control.yml` overlay; the internal network `craftlayer-game-control` exists.
2. **Owner:** Hosts page, **Connect a host**, paste the helper's public key and certificate fingerprint (given to you privately), approve. A script waiting on the VPS then writes the helper's private configuration and starts it within seconds; the host shows as connected.
3. **Owner approval, then operator:** run the staged private script that turns on RCON for the family server with a generated password, joins it to the internal network as `family-game` and restarts it once (about a minute). It refuses while anyone is playing, never publishes the port, and prints its own rollback.
4. **Owner:** Hosts page, **Servers this host looks after**, **Use this host** for the family server.
5. Verify with one harmless action (a message), then an allow and a removal of a test player. Record the evidence.

To roll back the stack update: retag the `pre-a2` images as `latest`, restore the saved `.env`, and `up -d` the four services. Migration 0033 is additive and can stay.

## Nightly backups (master plan D1)

Status 2026-11-12: built and verified locally ([ADR 0045](../architecture/decisions/0045-node-backups.md)); the code and migration 0034 are on the VPS at `d7bbb6d` but backups are **off** (no backup folder, switch unset). Needs the helper live (steps 2–4 above) and the owner's approval for one more CraftLayer-only stack update.

1. **Owner approval, then operator:** create a backup folder on the VPS outside the game data directory (owner-only, mode `0700`), update the checkout, add `infra/compose/game-backups.yml` and `CRAFTLAYER_GAME_BACKUP_DIR` to `.env`, add `data_directory` and `backup_directory` to the helper's private configuration, rebuild and `up -d`. Migration 0034 is additive. The game server is not restarted.
2. **Owner:** choose the backup time (the policy). Until the dashboard has the control (B2) the operator sets it through the API on the owner's behalf.
3. Verify with one "Back up now": the record shows complete and verified, the archive and manifest exist in the folder, and the server log shows saving turned off and on again. Record the evidence.

Archives are not encrypted yet and stay on the VPS until D2; free space is checked before every backup.

## Rollback

`docker compose -p craftlayer down` for this project only; the Minecraft containers are separate projects and are untouched. Data volumes are retained; removing them is a separate explicit step.
