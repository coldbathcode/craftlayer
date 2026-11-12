# ADR 0046 — The bound node reports who is playing and who is asking to join

Status: adopted for master plan steps A2 (live status) and A4 (knock to join) on 2026-11-12. Built and verified locally over a real mTLS transport with a scripted game console and a real knock file. Not yet in use on the family VPS; that state is on the [status board](../../plan/STATUS.md).

## Context

The dashboard showed a snapshot of the server taken from outside: stale within minutes and with no player names. The Knock plugin ([ADR 0037](0037-knock-to-join.md)) records accounts the server refused, but nothing carried them to a person. A bound node already holds the private control channel and can read the server's data directory ([ADR 0044](0044-server-action-dispatch.md)).

## Decision

1. **The node reports; the controller records.** Every ten seconds the node sends one `node.status.report.v1` per configured server on the existing mTLS listener, authenticated exactly like a heartbeat. The reply is signed and bound to the request. The route exists whenever server actions are enabled on the gateway: a node trusted to act on a server may say what it sees of it.
2. **"On" means the server answered.** Power is `on` only when the server's own console answered `list`; the names and counts are its words. When it does not answer, a node that may see the server's container ([ADR 0047](0047-node-power.md)) reports `off` or `starting`; otherwise it reports `unknown`. Nothing is inferred.
3. **Only the bound node is believed.** A report for a server not bound to the reporting active node is refused. One current row per server is kept (migration 0035), not a history.
4. **Stale is said, not hidden.** People read `GET /api/v1/servers/{id}/live`. A report older than 45 seconds, or a server with no host, is returned with `fresh: false` so a screen can say "last seen" instead of pretending.
5. **A knock is the account the server refused.** The node sends the newest twenty accounts from the plugin's file, with the Xbox account number derived from the account id itself. The controller keeps one row per account and server, refreshes it on each new refusal, and never shows the account number to anyone.
6. **Allow adds exactly that account, through the ordinary action.** `POST /api/v1/server-knocks/{id}/allow` creates the existing `allow_player` action in the adult's name, with the same permission check, audit and idempotency key, then marks the knock allowed. **Ignore** hides it. Children, watchers and agents can do neither.
7. **Decided knocks stay decided.** An ignored account asks again only if it is refused again more than 24 hours after the decision; an allowed account only if refused again more than two minutes after. Knocks older than 24 hours are not shown. Rows are never deleted and their identity cannot be changed, by the runtime role or anyone else.

## Consequences

- The report also carries the names on the server's allowlist file (migration 0036), so a screen can show who can join. It is kept from the last report that could read it.
- Without a bound, connected host there is no live status; the older outside snapshot remains for that case.
- The report costs one sequence number per server per ten seconds and one database write.
- A Bedrock gamertag is reconstructed from the name the server shows; it is only the label on the allowlist, since the account number decides who gets in.
- Agents can read live status with `server:read`; they still cannot allow a knock except by asking an adult ([ADR 0041](0041-agent-requests.md)).
- A phone notification for a new knock is not built.
