# ADR 0016 — Privileged node operations and non-destructive provisioning

Status: planned implementation contract, recorded 2026-11-02. Local F2.5 development is now authorized under ADR 0019; production host enrollment and changes still require explicit operator approval.

## Context

Managing existing Docker hosts is in Core scope. Docker control is host-privileged. Neither existing simulation workers nor a generic API wrapper provides host isolation. Adopted production worlds and unrelated workloads must survive failures and retries.

## Decision

F1 uses an observation-only local/private adapter without Docker control. F2 adds explicitly approved typed access/save/backup actions through an isolated control adapter. F2.5 introduces a separate node agent and local broker; API/web/MCP/general workers never mount the socket or receive RCON/node secrets. A minimal TypeScript service is the initial choice; Go, a new framework and provider API VPS creation are deferred.

Bind a one-use expiring enrollment to an adult-approved node/org/project and public key; exchange it for rotating/revocable mTLS identity. Use outbound connection only. Node jobs are signed, versioned, expiring, uniquely identified and bound to node/org/project/server, operation, attempt/fence, plan hash and local policy version. Verify signature/target/expiry/current session and replay state before accepting. No arbitrary shell/SSH/RCON/Docker proxy, image, mount, environment or network parameters.

Node policy limits existing-container mappings and approved immutable images/plugins, managed storage roots/volumes, resource bounds, networks and port ranges. Plan/approval binds the exact manifest, EULA adult acknowledgement, capacity reservations and target. Revalidate on dispatch; changed plans need renewed approval. Two competing operations cannot reserve the same resources. Inspection includes non-CraftLayer workloads. New game ingress stays closed until strict identity policy is installed and local readiness passes.

Persist operation intent/attempts/outbox in PostgreSQL and minimal fenced execution journal on node. Reconcile after lost responses/reconnect by immutable deployment ID and resource labels; do not create another container or assume physical exactly-once effects. Uncertain effects block replay. Revocation or durable stop blocks new mutable jobs; it never starts/stops a production game container implicitly. Backup save recovery is a narrowly bounded cleanup obligation, not permission for new work.

Rollback stops/removes only a container/network proven created by this operation, matching immutable ID, node, ownership labels and journal. Retain all world storage/backups by default, including failed-deployment data. Unknown/unlabelled ownership requires review. Never relabel an adopted container to make it deletable. Decommission retains data and backups; permanent erasure is a separate future owner-approved capability.

## Alternatives, risk and proof

API socket mounts, raw socket proxies and unrestricted local RCON amplify compromise. A broker restricts mistakes but cannot make a compromised Docker-capable host component safe. Prefer a dedicated host/rootless configuration where compatible; report residual host risk. No host changes occur in REC-01. Required F2.5 tests cover replay/revoke/expiry, cross-tenant jobs, collision races, hard quotas, kill points, safe rollback, existing-world preservation and effective management-port isolation.
