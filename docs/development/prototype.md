# Try the family management prototype

Status: runnable local F2 prototype; all game/server observations are synthetic. Pending identity requests use real scoped PostgreSQL/API/audit persistence. No Minecraft server, authenticated game bridge, player-access mutation, backup or restore is connected. The main installation and live worlds are not used.

## Start and sign in

```bash
pnpm install --frozen-lockfile
pnpm prototype:up
```

Docker/Compose and the pinned Node/pnpm versions are required. The script builds current production images into a separate `craftlayer-family-prototype` project, generates new credentials and separate database/Redis volumes, and publishes only the web edge on loopback. It prefers `http://127.0.0.1:3001/servers`; if that port is occupied on first setup it chooses another free loopback port and prints the URL. It never uses the main `.env`, users, volumes, world paths or provider configuration.

Private sign-in details for `prototype-parent`, `prototype-viewer` and `prototype-child` are in `.craftlayer-prototype/START-HERE.md` (mode 0600). Do not reuse these generated passwords. The directory is ignored by Git and Docker builds. Owner bootstrap is used only on the new prototype database. A protected browser state file is generated only for optional local prototype browser review, never from a real user session; it is not a production login shortcut or API route.

The parent can inspect two simulated servers, current capture provenance/freshness, fake players, activity and unverified security/recovery settings. “LOCAL PROTOTYPE · SIMULATED SERVER” distinguishes demo data from an actual game connection. Fake `.invalid` game addresses are deliberately not joinable. The viewer has explicit scoped reads and no adoption/enrollment controls; the child sees the adult-managed explanation and no server administration.

## First test journey

1. Sign in as the parent through `/account`, then open Servers.
2. Select Family Survival and Creative Garden; inspect online/offline and eventually stale capture labels, connection details and security/recovery gaps.
3. Under Players & access, select Java or Bedrock, enter a display name and request an identity check. The row stays **Pending · no access**, and scoped activity records the request. Reload to check persistence.
4. Try another browser/private session as the viewer; the identity request button and adoption controls must be absent. As the child, server administration is unavailable. Direct API writes remain denied independently of UI controls.
5. Switch organization/world or sign out; prior private data must clear. A new organization can be created through the normal Account UI if you want to explore an empty scope.
6. Optional metadata-only registration removal requires the exact server name; it retains the synthetic record/history and never stops/deletes a Minecraft container. Re-adopt the same approved source if needed.

Requests are only unresolved names, not authenticated UUID/XUID or web-to-game ownership bindings. They cannot be promoted by browser fields or a `/verify` route. Their 24-hour expiry is visible, and stored history is retained. The preview caps each server at 200 retained requests, pages of 50, and twelve actor/environment writes/minute; no automatic retention purge is implemented yet.

## Refresh, stop and resume

```bash
pnpm prototype:refresh
pnpm prototype:down
pnpm prototype:up
```

Refresh rewrites only the owned simulated capture. Click **Observe approved source** afterward to record its new timestamp; **Refresh overview** reads existing stored facts. Captures become stale after 60 seconds intentionally; this is not an automatic real game monitor. Normal `up` reuses existing prototype credentials/records and does not reseed a completed prototype. Do not delete the private state directory to reset a running installation.

Down stops only this prototype project and retains its volumes/credentials for later work; it never invokes volume removal/prune. There is no reset/delete command. Keep the prototype on loopback. Remote management remains blocked pending private entry/MFA qualification.

## Verification and remaining scope

`pnpm test:server-ui` creates its own separate disposable installation, tests the actual parent/viewer/child/browser/API path, and removes only its test resources. It does not reset the running prototype. `pnpm test:db` verifies RLS/FKs, immutable pending state, current authorization, idempotency and atomic audit/outbox in disposable databases. See [identity runbook](minecraft-identities.md), [F2 chapter](../chapters/F2-family-access.md) and [ADR 0018](../architecture/decisions/0018-game-identity-provenance.md).

Real authenticated bridge/event timing, explicit adult game-account binding, licensed Java/Bedrock admission/denial/rename/spoof/link tests, allowlist enforcement and recoverable backups remain F2 work. No EULA has been accepted and no game server has been booted. F2 is not complete and the family/Contabo deployment is not production-ready. This prototype is useful for testing the interaction flow while those gates remain open.
