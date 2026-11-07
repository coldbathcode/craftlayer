# Architecture decision records

Records 0001–0010 are proposed engineering defaults derived from the blueprint; later records state their own adopted/planned status and implementation evidence. None implies independent security certification. Add a new numbered record for material design changes and cross-link superseded decisions.

| ADR | Decision |
| --- | --- |
| [0001](./0001-monorepo-and-stack.md) | TypeScript monorepo and explicit package boundaries |
| [0002](./0002-core-cloud-independence.md) | Core independence and separate commercial service |
| [0003](./0003-tenant-boundary.md) | Application scope plus PostgreSQL tenant integrity |
| [0004](./0004-durable-orchestration.md) | PostgreSQL authority, outbox and at-least-once queue |
| [0005](./0005-model-cost-policy.md) | Fail-closed model eligibility and atomic budgets |
| [0006](./0006-deterministic-tools.md) | Structured AI plans and deterministic environment actions |
| [0007](./0007-emergency-stop.md) | Latched stop, leases and explicit resume |
| [0008](./0008-child-account-ceiling.md) | Adult-managed child identities and immutable approved presets |
| [0009](./0009-sandbox-and-egress.md) | Separate untrusted execution and controlled network access |
| [0010](./0010-events-and-contracts.md) | Versioned contracts and authorized resumable events |

Version selection, exact auth library, Minecraft authentication compatibility, sandbox runtime and license adoption remain explicit decisions in the risk register. Do not invent those decisions merely to close this index.

[ADR 0011 — Foundation toolchain and image pins](0011-foundation-toolchain.md) is adopted for Chapter 00; the original ten proposals retain their individual status until reviewed.

[ADR 0012 — Identity-service boundary](0012-identity-boundary.md) records Chapter 01's restricted auth role, tenant constraints and upgrade provisioning.

[ADR 0013 — Provider gateway boundary](0013-provider-gateway-boundary.md) records Chapter 02 provider contracts, strict cost eligibility, operator endpoint trust and durable accounting decisions.

[ADR 0014 — Runtime authority and recovery](0014-runtime-authority-and-recovery.md) records Chapter 03 simulation scope, worker/coordinator trust, leases, truthful cancellation and durable queue/events.

[ADR 0015 — Unified control plane and management delivery order](0015-unified-control-plane.md) adopts documentation reconciliation and F0–F3 ordering, preserving original task IDs and chapter evidence; it grants no implementation scope.

[ADR 0016 — Privileged node/provisioning boundary](0016-node-provisioning-boundary.md) records the planned outbound node identity, signed commands, fixed broker policy and ownership-safe recovery contract; implementation remains gated.

[ADR 0017 — Minecraft observation boundary](0017-minecraft-observation-boundary.md) records the F1 registry, scoped permissions, atomic local operations and cross-pool session-lock decision.

[ADR 0018 — Game identity provenance](0018-game-identity-provenance.md) keeps Java/Bedrock subjects distinct, gates authenticated enrollment and separates pinned candidate artifact integrity from real client qualification.

[ADR 0019 — Private node trust](0019-private-node-trust.md) records user-authorized parallel infrastructure development, mTLS/key/certificate-bound enrollment, replay/rotation/revocation and the initial inventory-only boundary.

[ADR 0020 — Node execution journal](0020-node-execution-journal.md) defines signed current permits, durable local intent/receipts, fences/stop and conservative uncertainty without enabling host effects.

[ADR 0021 — Node reservation ledger](0021-node-reservation-ledger.md) defines short scoped transactions, qualified private admission, expiring metadata holds and retained uncertain allocations.

[ADR 0022 — Constrained Engine policy](0022-constrained-engine-policy.md) records fixed image/resource/mount/network policy and guarded non-destructive Docker verbs.

- [0023 — Durable broker ownership](0023-node-broker-ownership.md).

- [0024 — Durable provision controller](0024-durable-provision-controller.md).

- [0025 — Remote execution authority](0025-remote-execution-authority.md).

- [0026 — Deployment background dispatch](0026-deployment-background-dispatch.md).

- [0027 — Durable node receipt delivery](0027-node-receipt-delivery.md).

- [0028 — Rolling management admission](0028-rolling-management-admission.md).

- [0029 — Enrollment history pagination](0029-enrollment-history-pagination.md).

- [0030 — Durable deployment review requests](0030-durable-deployment-review-requests.md).

- [0031 — Operator playtest first](0031-operator-playtest-first.md).

- [0032 — Independent deployment decisions](0032-independent-deployment-decisions.md).
