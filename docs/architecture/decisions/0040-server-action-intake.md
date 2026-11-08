# ADR 0040 — Typed server actions as durable requests

Status: adopted for master plan step A3 (intake), 2026-11-08. Requests, permissions, fencing, audit and result recording are built and verified in the database suite. No node dispatch exists yet, so no action reaches a server.

## Context

Milestone A needs buttons: allow or remove a player, kick, message, save, start, stop, restart. The game-control library ([ADR 0036](0036-game-control-channel.md)) can perform them on a node, and the provisioning pipeline shows how commands travel to a node under signed, fenced, leased authority. That pipeline is deliberately heavy (reservations, two-adult approval, qualification) because provisioning creates infrastructure. Player and lifecycle actions on an existing family server are frequent, bounded and reversible; they need the same honesty about outcomes with far less ceremony.

## Decision

1. **A closed set of typed actions.** `allow_player`, `revoke_player`, `kick_player`, `say`, `save`, `start`, `stop`, `restart`, each with a strict request shape in `@craftlayer/contracts`. There is no free-text command anywhere in the contract; names, gamertags, XUIDs and messages carry the same limits the node enforces again.
2. **Permission per kind.** Player actions need `player:manage`; lifecycle and chat need `server:control`. Both are new adult permissions held by administrators by default and grantable per environment. Children and agent tokens are refused outright; agents will get an approval-mediated request path in C3.
3. **Durable, fenced, idempotent.** Each request is a `server_action` operation plus one row in `minecraft_server_actions` with a per-server fence that only ever increases, a 10-minute expiry, and the request key for idempotent replay (a different body under the same key conflicts). At most eight actions may be open per server; a lifecycle action cannot be queued while anything else is open, and nothing can be queued behind a pending lifecycle action.
4. **Forward-only state with the server's own words.** `pending → dispatched → succeeded | failed`, or `pending → cancelled | expired`. Success requires the node's evidence with `ok: true`; identity, request and dispatch time are immutable; rows are never deleted. Every transition writes a reference-only outbox event, and requests and cancellations are audited.
5. **Dispatch is the node's, not HTTP's.** `claimNext`, `recordResult` and `expireStale` are composition-trusted methods for the node dispatch path; browsers and agents cannot mark anything dispatched or succeeded. An action for a server with no bound node is shown as `awaiting_node` so the UI can say so instead of spinning.
6. **Aliases later, one resource now.** `POST /servers/{id}/actions` is the single intake; the planned `/allowlist`, `/kick`, `/start` routes become thin aliases onto it when the UI needs them, sharing the same idempotency and audit.

## Consequences

- Slice 2 (with A2) adds the node poll/receipt purposes that carry these actions over the existing mTLS transport, executes them with `GameActions`, and records results through `recordResult`. Until then every action stays `pending` and, after ten minutes, `expired`.
- The knock card (A4) and agent requests (C3) both end in `allow_player` requests here.
- `stop` and `start` are typed requests, not container operations; the node maps them to a graceful console stop and a container start for a server it owns.
