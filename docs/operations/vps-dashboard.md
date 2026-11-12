# Hosting the dashboard on the VPS (master plan A1)

Status: deployed on 2026-11-08 at commit `ca524ec` as Compose project `craftlayer` under `/home/oli/craftlayer`: postgres, redis, api, worker and web healthy, migrations through 0032 applied, web listening on `127.0.0.1:3000` only (checked from outside: public port 3000 closed). Not yet reachable by the owner: HTTPS certificates and `tailscale serve` are pending, and the owner account has not been created. Nothing here opens a public port: the dashboard is reachable only on the family's Tailscale network, over HTTPS.

## Shape

- The same Compose stack as local development (postgres, redis, migrate, api, worker, web) runs as its own project on the VPS, with the web edge published on `127.0.0.1:3000` only.
- `tailscale serve` on the host terminates HTTPS with a certificate for the machine's tailnet name and proxies to that loopback port. No firewall change, no public listener.
- `CRAFTLAYER_PUBLIC_URL` is the tailnet HTTPS address, so cookies are `Secure` and the Origin check matches. `CRAFTLAYER_REQUIRE_MFA=true`, so every adult must enrol an authenticator at first sign-in.
- The dashboard's own database is meant to get a nightly `pg_dump` kept on the VPS. The job is built but **not enabled yet** (see [Dashboard database backup](#dashboard-database-backup-master-plan-a1)); pulling the dumps to the owner's Mac waits for D2.
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

## Remote MCP (master plan C4)

Status 2026-11-12: built and verified locally ([ADR 0048](../architecture/decisions/0048-remote-mcp.md)). **Nothing below has been done on the VPS.** These are the steps for later; each VPS write needs the owner's approval first. Configuration reference: [agent access](../development/agent-access.md#remote-mcp-c4).

1. **Owner approval, then operator:** update the checkout. Add to `.env`: `CRAFTLAYER_MCP_ORGANIZATION` (the family organization ID) and `CRAFTLAYER_MCP_ALLOWED_HOSTS=vmi2954874.taile167a3.ts.net`. Add `infra/compose/mcp.yml` to the Compose files in use, then build and start only the new service (`docker compose … up -d --build --wait mcp`). No migration, no change to the other services, and the game server is not touched. The container holds no token, database password or key.
2. **Operator:** confirm the service is healthy and listening on `127.0.0.1:3900` only, and that the public interface shows no new port (check from outside, as for the dashboard).
3. **Owner (needs sudo):** publish it on the tailnet on its own HTTPS port, leaving the dashboard on 443: `sudo tailscale serve --bg --https=8443 http://127.0.0.1:3900`. The address is then `https://vmi2954874.taile167a3.ts.net:8443/mcp`. Do not use `tailscale funnel`; that would make it public.
4. **Operator:** from a tailnet device, check that `GET /health/live` answers, that a `POST /mcp` without a token answers `401`, and that the service log shows only codes. If every request answers `403 HOST_REJECTED`, the proxy is sending a different `Host`; read which one with a local request on the VPS and correct `CRAFTLAYER_MCP_ALLOWED_HOSTS`. Do not widen the list beyond the names actually used.
5. **Owner:** create an agent token for one device, connect Claude Code with the bearer header, and ask "Who is on Family Survival?". Then revoke the token and confirm the next question fails. Record the evidence.

To roll back: `sudo tailscale serve --https=8443 off`, then `docker compose … rm -sf mcp`. Nothing else depends on the service; the local stdio server keeps working.

## Dashboard database backup (master plan A1)

Status 2026-11-12: built and checked locally with `pnpm test:db-backup`. **Not enabled on the VPS.** The steps below are for later; each VPS write needs the owner's approval first.

This backs up the dashboard's own database (accounts, audit, records), not Minecraft worlds. An optional service, `database-backup`, takes one dump shortly after it starts and then one every day at a set time. It writes `craftlayer-db-<UTC time>.dump` plus a `.sha256` file next to it, keeps the newest 14 and deletes older ones. A file only gets its final name after `pg_restore --list` could read it, so every `.dump` in the folder is complete. The service publishes no port, runs as a non-root user with a read-only filesystem, and is limited to 128 MB and half a CPU.

**The dumps contain account data and hashed credentials and are not encrypted.** Keep the folder private (mode `0700`), outside the repository, and never commit or share a dump.

Settings in `.env`:

| Name | Default | Meaning |
| --- | --- | --- |
| `CRAFTLAYER_DB_BACKUP_DIR` | none, required | Folder on the VPS for the dumps |
| `CRAFTLAYER_HOST_UID`, `CRAFTLAYER_HOST_GID` | none, required | Owner of that folder (`id -u`, `id -g`); already set where the node overlay is used. Must not be root |
| `CRAFTLAYER_DB_BACKUP_TIME` | `03:30` | Daily time, `HH:MM` |
| `CRAFTLAYER_DB_BACKUP_TZ` | `UTC` | Time zone for that time, for example `Europe/London` |
| `CRAFTLAYER_DB_BACKUP_KEEP` | `14` | How many dumps to keep |

To enable:

1. **Owner approval, then operator:** create the folder outside the checkout, for example `mkdir -m 0700 /home/oli/craftlayer-db-backups`.
2. Update the checkout, add the settings above to `.env`, and add `infra/compose/database-backup.yml` to the Compose files in use (`COMPOSE_FILE`).
3. Start only the new service: `docker compose up -d database-backup`. No migration, no rebuild and no restart of the other services or the game server.

To check:

- `docker compose logs database-backup` shows one line per run: `database_backup_ok <time> bytes=<size> kept=<count>`, or `database_backup_failed <time> stage=<step>`. After a failure it tries again every 15 minutes.
- `docker compose ps database-backup` shows `healthy` while the newest dump is under 26 hours old.
- In the folder, `sha256sum -c craftlayer-db-<time>.dump.sha256` answers `OK`.

To restore (rehearsed locally on a throwaway database; needs the owner's approval on the VPS):

1. Pick a dump and check it with `sha256sum -c` as above.
2. Stop everything that uses the database, leaving it running: `docker compose stop web worker api database-backup` (and `node-control` if it is in use).
3. Restore into a fresh, empty database beside the current one:
   ```sh
   docker compose exec -T postgres createdb -U craftlayer_admin craftlayer_restore
   docker compose exec -T postgres pg_restore -U craftlayer_admin -d craftlayer_restore --exit-on-error < /home/oli/craftlayer-db-backups/craftlayer-db-<time>.dump
   ```
4. Look at the restored copy before switching, for example `docker compose exec -T postgres psql -U craftlayer_admin -d craftlayer_restore -c '\dt'`.
5. Swap the names and give the service accounts back their right to connect (this is the one setting a dump does not carry):
   ```sh
   docker compose exec -T postgres psql -U craftlayer_admin -d postgres -v ON_ERROR_STOP=1 \
     -c "ALTER DATABASE craftlayer RENAME TO craftlayer_before_restore" \
     -c "ALTER DATABASE craftlayer_restore RENAME TO craftlayer" \
     -c "REVOKE ALL ON DATABASE craftlayer FROM PUBLIC" \
     -c "GRANT CONNECT ON DATABASE craftlayer TO craftlayer_migrator, craftlayer_runtime, craftlayer_identity"
   ```
6. `docker compose up -d --wait`, sign in and check the audit page. Record the evidence.
7. The previous database stays as `craftlayer_before_restore`. To undo, stop the same services and swap the names back. Drop it only after the owner agrees the restore is good.

On a brand-new machine the same steps apply after `docker compose up -d --wait postgres`: the first start creates the service accounts with the passwords from `.env`, so use the saved `.env` or expect the accounts' passwords to be the new ones. Sessions and codes created after the dump was taken are gone; people sign in again.

To turn it off: `docker compose rm -sf database-backup` and remove the overlay from `COMPOSE_FILE`. The dumps stay in the folder.

## Rollback

`docker compose -p craftlayer down` for this project only; the Minecraft containers are separate projects and are untouched. Data volumes are retained; removing them is a separate explicit step.
