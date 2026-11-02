# Secure node development and deployment preparation

Status: CL-F25-01 checkpoint A, locally implemented read-only node trust/transport. No provisioning/job/lifecycle/backup authority exists yet. [ADR 0019](../architecture/decisions/0019-private-node-trust.md) records scope and [F2.5](../chapters/F2.5-docker-provisioning.md) retains release gates. No Contabo access or node installation has occurred.

## Trust setup

An adult with current project `node:enroll` approves a node public signing key and exact mTLS client certificate SHA-256 fingerprint. New default node permissions belong only to Org Admin; custom adult roles need explicit scope, children remain denied. POST `/api/v1/nodes/enrollments` accepts project/name/public_key/certificate_sha256 and a UUID Idempotency-Key; response is a durable operation/node reference. Enrollment is one-use/five minutes. The reference is not a secret bearer token: activation requires the corresponding TLS certificate/private key and Ed25519 proof.

The dedicated node-control listener requires TLS 1.3, trusted client CA and certificate, then validates the registered fingerprint, key, scope, credential generation, signed purpose/control identity, 30s proof window and monotonic sequence. Agent validates the server CA/name, exact server certificate fingerprint and signed response/control key. It connects only to literal private/loopback/CGNAT/ULA HTTPS controller addresses, without redirects, public/DNS/metadata/HTTP fallback. Its transport has no listener, cookie auth or arbitrary command envelope.

`GET /api/v1/nodes?project_id=…[&cursor=…]`, `/nodes/:id`, `/capacity` and canonical `/operations/:id` expose bounded scoped views. Lists are newest-first with a scoped UUID boundary. Admission limits count at most 100 active/unexpired enrollments per project and rolling daily/minute operation windows, not lifetime totals; expired/revoked entries retain history without occupying an enrollment slot. Archival/retention maintenance remains a release concern. Node `/capacity` returns the same node envelope with timestamped capacity. `/node-operations/:id` is a receipt alias. POST `/nodes/:id/rotate` approves new signing key/client certificate with expected version/idempotency; POST `/revoke` invalidates further requests. Old credentials remain immutable and cannot be reused for another enrollment. Rotation starts a new sequence generation; credentials expire after 24 hours and require an explicit renewed approval. Human remote management remains blocked pending private entry/MFA qualification.

## Local certificate fixtures and agent commands

With OpenSSL available, generate a **new, nonexistent** private test directory:

```bash
pnpm build:server
pnpm node:pki:fixture /absolute/new/private/test-directory
pnpm node:keygen /absolute/new/agent-key-directory /absolute/path/to/client.crt
pnpm node:run /absolute/path/to/private-agent-config.json
```

The fixture generator is for localhost tests: a two-day private CA/server/client certificate set, local server SANs and signing keys. It never accepts Minecraft EULA, starts a game, modifies host trust, overwrites an existing directory, contacts a VPS or issues production credentials. All files are mode 0600 under mode 0700. CA private key remains operator-side; never mount it in API/gateway/agent or put it in Git.

An operator-managed production PKI must provide the appropriate private-controller SAN, client-auth certificates and secure issuance/rotation process. Do not reuse local fixture trust as production qualification. Agent config is owner-only, regular/non-symlink and contains organization/node/credential generation, private HTTPS control URL, pinned control signing key/server certificate fingerprint, CA/client certificate/TLS key/signing key file paths, private journal directory and local Unix Docker socket. File paths are local operator configuration, never caller-selected API/node-command paths. The API's optional `CRAFTLAYER_NODE_CONTROL_PUBLIC_KEY` contains only the controller public signing key. Private gateway `apps/api/dist/node-main.js` reads `server.key`, `server.crt`, `ca.crt` and `control.key` from its protected `CRAFTLAYER_NODE_TLS_DIRECTORY`; default bind is loopback, port 9443. No public node port is authorized.

Agent key generation outputs public metadata only. Private files never enter browser bundles/logs/requests. Gateway signs no shell/RCON/Docker verbs; protocol accepts enrollment/heartbeat and inventory-only acknowledgements. This checkpoint has no remote installer, public endpoint, auto-approved mutable commands or game connectivity.

## Inventory and reliability limits

Agent reads fixed Engine API 1.50 info/container-list/inspect routes over an operator-selected local Unix socket, at most 256 containers, 128 published bindings, 1 MiB response, four inspect requests at a time, 2s per request and a bounded inventory pass. It includes declared allocations and Docker port bindings from stopped/unrelated containers without exposing names/IDs/environments/mounts. Unbounded memory allocation is counted rather than assumed free. Failures report unavailable rather than an empty host. Reported capacity cannot qualify provisioning; OS/native ports, free storage, effective networking and hard disk quota remain unverified.

mTLS heartbeat is every ten seconds; node connection becomes offline after 30 seconds. This is no physical lease/watchdog or exactly-once guarantee. Sequence is persisted/fsynced before requests; signed acknowledgements bind its exact payload. Lost enrollment acknowledgement can be reconciled only under the already-registered key/certificate, not by approving new credentials. Journal and lock are private and bound to node identity. On an unclean process exit, inspect the task-owned lock and retained sequence before a controlled restart; do not blindly delete state/reset sequence. Network failure fails closed; automatic reconnect/lease fencing and physical execution are unfinished gates.

Compromise of this socket-capable process can compromise its Docker host. Read-only API usage or a read-only socket mount is not host isolation. Deploy the eventual broker on a dedicated host where possible and qualify fixed operation/image/mount/network/resource policies before accepting effects. No API/web/general worker gets Docker or game-data access.

## Verification boundary

`pnpm check` covers node signature/time/schema boundaries, private address requirements, selected inventory projection and journal behavior. `pnpm test:db` creates an additional disposable node database and real local mTLS fixture; it tests current scope/child/viewer denial, concurrent enrollment replay, atomic audit/outbox, certificate/key/time replay denials, actual TLS client/server pinning, rotation/revocation, credential history/RLS/FKs and HTTP/CSRF/OpenAPI/operation projection. No live game/client/node-command/provision/backup/restore/remote-network proof is implied.
