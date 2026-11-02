# Primary engineering references

Reviewed 2026-10-31 for this planning pass. These references support specific design constraints, not a guarantee that future versions behave identically. Recheck official documentation for the exact pinned release during implementation. Dependency versions, model prices and provider commercial terms are intentionally not frozen in this plan.

| Reference | Planning consequence |
| --- | --- |
| [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) | Runtime roles must be non-owner/non-bypass; tenant policies need both visibility and write checks |
| [BullMQ stalled jobs](https://docs.bullmq.io/guide/jobs/stalled) | Worker recovery can repeat delivery; task state and reconciliation belong in PostgreSQL |
| [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs) | Keep actions bounded with explicit retry-safe semantics |
| [BullMQ job IDs](https://docs.bullmq.io/guide/jobs/job-ids) | Queue IDs alone cannot provide permanent deduplication |
| [OpenRouter free variants](https://openrouter.ai/docs/guides/routing/model-variants/free) | Free model selection cannot justify an unreviewed paid fallback |
| [OpenRouter model catalog](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties) | Discover capability/pricing metadata instead of hardcoding current free model names |
| [Docker Engine security](https://docs.docker.com/engine/security/) | Treat daemon control as privileged and keep it out of general agent processes |
| [Docker rootless mode](https://docs.docker.com/engine/security/rootless/) | Evaluate non-root deployment while retaining explicit sandbox boundaries |

The Supabase Postgres best-practices skill informed index, transaction and RLS review. It does not imply adopting Supabase or depending on its hosted authentication APIs.

## Research required at chapter start

- Chapter 00: supported Node/pnpm/TypeScript/Next/Fastify/Drizzle/BullMQ/Postgres/Redis versions, licensing, image architecture support and compatibility matrix.
- Chapter 01: vetted auth/hash/session libraries and their maintenance/security state; OIDC remains deferred.
- Chapter 02/07: provider SDK/HTTP contracts, usage fields, retry defaults, pricing units, zero-cost enforcement, data retention and terms. Do not infer resale rights from technical API access.
- Chapter 04: Mineflayer/protocol/pathfinder/Java server compatibility and legitimate bot authentication mode for the chosen private server.
- Chapter 08: sandbox runtime/egress controls and chosen fetch/extraction libraries; test actual isolation rather than relying on a product label.
- Chapter 09: dependency/image licenses, release security advisories and platform installation behavior.
- Chapter 10/11: provider commercial permissions, subscription/payment behavior, privacy/tax obligations and hybrid runner threat model; specialist review where needed.

Do not claim domain availability, trademark clearance, guaranteed capacity, legal compliance or provider resale permission from this document. Those remain unresolved launch decisions.

## Unified management planning references — 2026-11-02

Read-only official documentation consulted for REC-01. These support the planned boundaries; they do not qualify installed Contabo versions. At F0/F2 pin the actual Paper/Geyser/Floodgate build and verify its behavior before selecting commands.

- [Docker Engine security](https://docs.docker.com/engine/security/): daemon access is highly privileged; restrict the node trust domain.
- [Docker packet filtering/firewalls](https://docs.docker.com/engine/network/packet-filtering-firewalls/): inspect effective Docker networking/firewall rules rather than treating a host firewall summary as sufficient.
- [Floodgate features](https://geysermc.org/wiki/floodgate/features/): Floodgate documents edition-aware whitelist support and UUID input; qualify the installed version and identity provenance before any access change.
- [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization): plan resource/audience-bound OAuth for HTTP transport; pin SDK/protocol at F25 implementation. CraftLayer requires remote authentication regardless of generic optional protocol support.
