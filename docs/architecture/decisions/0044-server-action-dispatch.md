# ADR 0044 — Server actions travel to a bound node over the private transport

Status: adopted for master plan step A2 on 2026-11-12. Built and verified locally with a real mTLS transport and a scripted game console; installation on the family VPS is recorded in the [status board](../../plan/STATUS.md).

## Context

Typed server actions ([ADR 0040](0040-server-action-intake.md)) were durable requests with nobody to carry them out, and the game-control library ([ADR 0036](0036-game-control-channel.md)) could perform them only from a test. The node agent already had an authenticated, signed, outbound-only link to the gateway ([ADR 0019](0019-private-node-trust.md), [ADR 0043](0043-single-host-node-transport.md)). The provisioning pipeline shows a much heavier route (reservations, sealed authority, two-adult approval); that weight is for creating infrastructure, not for allowing a player.

Two smaller gaps blocked a long-running host: node credentials expired after 24 hours by a database rule, and nothing recorded which host acts for an adopted server.

## Decision

1. **A server is bound to one host by an adult.** `PUT /api/v1/servers/{id}/node` records that an active host in the same project carries out this server's actions; `DELETE` releases it. It needs `server:control` on the server's world and `node:enroll` on its project, adults only. Bindings are kept as history, and a binding cannot change while an action is in flight. An action for an unbound server is shown as `awaiting_node`.
2. **The node asks; the gateway offers one action.** Two new purposes ride the existing mTLS listener: `node.actions.poll.v1` (the node lists the servers it holds a control channel for) and `node.actions.result.v1`. Each is signed by the node, checked exactly like a heartbeat (certificate, credential, signature, 30-second window) and consumes the node's strictly increasing sequence, so a captured request cannot be replayed. Each reply is signed by the control key and bound to the request's hash. The routes exist only when the operator sets `CRAFTLAYER_NODE_ACTIONS=enabled` on the gateway.
3. **Checked again at dispatch.** The gateway offers an action only for a registered server bound to that active node. Nothing is dispatched while an emergency stop is latched for the instance, organization or world. If the adult who asked is no longer an active member, the action is cancelled instead of run. Permissions themselves are not re-evaluated at dispatch: the gateway deliberately holds no identity service, so a permission removed after the request can still take effect for at most the action's ten-minute life. An emergency stop closes that window.
4. **At most once, by journal.** The node writes an action to a private journal before running it and writes the answer before sending it. An action dispatched but not settled is offered again to the same node; the node answers from its journal and never runs it a second time. An action found in the journal with no answer after a restart is reported as `interrupted`, not retried. The node also keeps the last fence it accepted per server and refuses anything older.
5. **Only the dispatched node may answer.** The action row records the node it went to (set once at dispatch); a result must come from that node with the same server and fence. A repeated answer changes nothing. An answer that arrives after the action expired cannot rewrite the record, so it is written to the audit log as `server.action_late_result`.
6. **Typed all the way down.** The offer carries the same strict request shape the API accepted; the node maps each kind to one fixed verb of `GameActions`, which validates its arguments again. No console text is built from caller input anywhere. `start`, `stop` and `restart` are answered truthfully as not available on this host until the node's container lifecycle step (A3) is built.
7. **The control channel stays private.** The node reaches RCON by a private address or a name on an internal Docker network that only the gateway (whose network namespace the agent shares) and the game server join; the agent refuses a non-private address. The password is read from a protected file at use and never kept, logged or sent. The operator's agent configuration names the servers; callers never choose a host, port or path.
8. **Credential lifetime is the operator's choice.** `CRAFTLAYER_NODE_CREDENTIAL_DAYS` (1 to 400, default 1) sets how long an approved node credential lasts; the database ceiling moves from 24 hours to 400 days. The client certificate's own expiry is still enforced on every request, and rotation and revocation are unchanged.

9. **The gateway answers its own loopback.** In a container the gateway listens on its private address only, so an agent sharing its network namespace ([ADR 0043](0043-single-host-node-transport.md)) could not reach `127.0.0.1:9443`. The gateway now relays loopback connections inside its own namespace to that listener byte for byte; TLS and the client certificate still terminate at the gateway, and nothing outside the namespace gains a path.

## Consequences

- The agent container needs the game server's data directory (to rewrite `whitelist.json` atomically) and a route to its RCON port. Together with the Docker socket it already holds, the agent remains the one privileged piece (ADR 0016).
- A lost reply delays an action by one poll; it does not lose or repeat it. A node that stays unreachable leaves the action to expire after ten minutes.
- A longer credential lifetime trades daily re-approval for a longer window if a node key is stolen. Revocation takes effect on the next request.
- Live player lists, knocks and backups will use the same link with their own purposes.
