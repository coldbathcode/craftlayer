# Durable provision controller development

Status: CL-F25-03 checkpoint B implements a private first-provision controller; it is not installed in the API/gateway/worker or inventory agent. [ADR 0024](../architecture/decisions/0024-durable-provision-controller.md), [intake](deployment-intents.md), [execution](node-execution.md) and [broker](node-broker.md) define the composition. Existing prototype remains inventory/planning-only.

`DeploymentJobs.prepare` accepts an immutable intake reference and idempotency key from its original current adult session. It issues node-placement and canonical Minecraft provisioning grants through identity, validates both in one identity transaction, obtains trusted qualification outside SQL, then rechecks and persists one control-signed command/lease/audit/reference-only outbox in SQL 0022. No production qualifier is provided; default fails unavailable. Domain port tests use explicit fake qualification/independent approval and do not qualify a game image or host.

Each intake permits one provision command, attempt/fence 1 and at most 30s. Concurrent identical requests return the same operation; a different key conflicts. No automatic retry, lease extension/takeover, lifecycle command, polling or queue consumer is installed. Signed command bytes and private identity grants are retained in PostgreSQL; public views/outbox contain references/status only. `succeeded` describes verified stopped provision resources, not a playable Minecraft server.

Node-signed fetch and permit request purposes bind control/tenant/project/node/credential/job/hash, one-use request ID and a fresh permit nonce where appropriate. The peer certificate hash/lifetime must come from a verified private mTLS connection. The service revalidates current node/key, original session/user/membership and both canonical permissions, policy, unchanged allocated reservation, stop epochs and fresh exact qualification before each fetch/permit. Permits expire within 5s and never outlive the job/session/credential. There are at most 64 recorded requests per job; replay/exhaustion fails closed. Clock rollback, stale proof, cancellation and approval/policy/stop changes deny new effects. A previously issued physical effect cannot be retroactively canceled.

`recordReceipt` verifies the node signature and exact command/tenant/resource/fence binding. Identical replay is idempotent; conflicting receipt is refused. Unknown or expired work retains uncertainty/capacity/ports. `settleExpired` lets a currently authorized adult record expiration metadata without reissuing work; it does not require the original requester to remain active. A late signed success receipt does not clear prior uncertainty. Known compensation/no-dispatch also retains world/storage/port accounting pending future evidence-bound reconciliation. Never edit/drop rows or journals to retry a command.

## Checks and evidence

```bash
pnpm check
pnpm test:db
```

The DB launcher creates a fifth isolated identity/runtime database for controller tests; it does not migrate the prototype or an existing installation. Eighteen new cases cover concurrent one-command issuance/reopen/atomic records, original current authority/child/tenant/session checks, default unavailable qualifier, exact signature/pin/request/nonce binding and replay, revocation during qualification I/O, changed approval, rotation/revocation, durable stop epochs, all receipt states, expiry/late evidence without takeover/release, SQL immutability/RLS, batch grant isolation, qualification failures, clock rollback/cancellation and bounded request journals. Existing 132 integration cases still run. Two new contract cases reject caller scope/commands and mixed fetch/permit purposes. These tests have no real node network or Docker/game effects; the separate broker fixture remains distinct.

## Next integration and isolation

Add an outbound-only pinned mTLS command transport and optional test composition, then a remote current-authority adapter and independent approval/real host qualifier. Keep the installed gateway runtime-only and inventory-only until that composition is qualified. API/web/general workers must not acquire node control keys or Docker access; gateway must not acquire identity DB/CSRF secrets. In-process test injection of `AuthService` is not production deployment guidance. A real disposable DB + network + broker exercise should verify the entire chain with explicit fake game qualification before any Minecraft release claim.

Automatic expiry/reconciliation/archival, safe credential recovery, persistent world quotas, game configuration/ingress/readiness and identity/backup/isolated restoration remain required. No Contabo install, EULA acceptance, existing game/world changes or paid inference are authorized by these local checks.
