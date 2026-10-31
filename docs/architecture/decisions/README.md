# Architecture decision records

These ten records are proposed engineering defaults derived from the blueprint. They are ready for review; none is represented as a measured/approved implementation. Add a new numbered record for material design changes and cross-link superseded decisions.

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
