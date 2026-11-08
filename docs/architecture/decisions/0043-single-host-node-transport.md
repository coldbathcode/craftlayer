# ADR 0043 — Single-host node transport for the family VPS

Status: adopted for master plan step A2 on 2026-11-08. Covers how the node gateway and node agent run on the one VPS that also hosts the dashboard and the game.

## Context

The node design ([ADR 0016](0016-node-provisioning-boundary.md), [ADR 0019](0019-private-node-trust.md)) assumes a gateway reachable over a private mTLS transport and an agent on the Docker host. In the family deployment the dashboard, gateway, agent and game all share one VPS. The existing PKI tooling produces a two-day local test fixture, and the gateway binds to a private address of its container; neither fits a long-running single host without decisions.

## Decision

1. **Operator-private CA, generated off-host, long-lived.** The same fixture generator produces the CA and leaf certificates, with `CRAFTLAYER_NODE_PKI_DAYS` (capped at 400) and optional server SANs. For the family VPS it was run on the owner's Mac into the owner's private folder with one-year validity; private keys were copied once to the VPS over SSH into a mode-700 directory and never into Git. Renewal is an explicit operator step, as with the local fixture.
2. **Agent in the gateway's network namespace.** The agent container uses `network_mode: service:node-control`, so it reaches the gateway at `https://127.0.0.1:9443` with the fixture's default SAN, has no network interface of its own, publishes nothing, and cannot be reached by anything. The gateway stays on the internal Compose network plus the edge network as before.
3. **One privileged container.** Only the agent mounts the Docker socket (read-write, for the inventory now and owned-resource lifecycle later). It runs as the owner's UID with the docker group added, read-only root, all capabilities dropped, no new privileges, 256 MB. Nothing else in the stack mounts the socket.
4. **Enrolment stays human.** The owner approves the agent's public signing key and client-certificate hash in the Hosts page; the agent must start within the five-minute window. The agent configuration (node ID, credential version, pins, file paths) is written by the operator from the approved enrolment and mounted read-only.
5. **A dedicated image target.** `infra/images/Dockerfile` gains a `node` target that deploys only `@craftlayer/minecraft-node`; the agent is not inside the API image.

## Consequences

- The agent currently enrols, heartbeats and reports read-only Docker inventory. Server actions, backups and knocks still need the dispatch work that follows.
- Compromise of the agent remains compromise of the host (ADR 0016); the shared namespace does not change that, and the agent has no inbound path.
- A multi-host future keeps this layout per host; only the transport address and SANs change.
