# ADR 0015 — Unified Core and family management delivery order

Status: adopted for documentation reconciliation, 2026-11-02; implementation and production approval remain separate. Supersedes the delivery order and first-preview outcome in the original derived roadmap/PR release scope, not completed behavior or historical review evidence.

## Context

Chapters 00–02 and six Chapter 03 tasks already exist. Unified v0.4 makes preserving and managing the existing family server the immediate outcome. Rebuilding auth, provider routing or runtime would delay safety and introduce conflicting authority.

## Decision

One self-hosted Core shares current auth, core permissions, PostgreSQL/RLS, append-only audit, contracts, API/SDK, job patterns and dashboard. Preserve installed package names, pins, SQL history, API contracts and the original blueprint. Add an independently testable F track: F0 preflight, F1 read-only adoption/dashboard, F2 family access/backups, F2.5 Docker provisioning, F3 broader lifecycle/monitoring, then original Chapters 04 onward. F1 relies on Chapters 00–01; no model or bot runtime is required. Do not rebuild completed Chapter 03 work; finish its authorized review separately.

Management operations are distinct durable domain records, not missions. Reuse outbox/lease/approval ideas behind interfaces without importing simulation-only capabilities or granting bots infrastructure authority. Management mutations return operation IDs and require current authority at request, worker and effect dispatch. Extend audit/correlation and permissions additively.

F1 is an observation preview. F2 is the earliest usable secure access/backup dashboard, contingent on real identity/restore/security evidence. Full requested lifecycle dashboard arrives in F3. Family preview is not full Core v0.1 (Chapters 00–09 plus applicable F gates). No Cloud, provider API or remote hosted identity is required for local operation.

Canonical new permissions retain existing singular colon vocabulary. Canonical APIs/tools and input conflicts are recorded in the reconciliation and management architecture. Use canonical ADR numbering; the build prompt's requested `ADR-001-unified-control-plane.md` is a navigation pointer to this record, not a second decision.

## Alternatives and consequences

Replacing earlier chapters or renaming the workspace wastes proven work and risks compatibility. Waiting until bot Chapter 05/09 for server safety delays family usefulness. A separate product/auth stack duplicates security policy. The F track adds operation/node/backup domains and release gates; later 04/05/09 must extend their proven fixtures/UI/runbooks rather than duplicate them.

## Validation and authorization

REC-01 structural documentation checks do not prove runtime security. Each F phase needs its own review and explicit implementation authorization; Contabo access/writes/deployment have separate gates. This ADR does not close CL-03-07 or authorize Chapter 04, a public release, purchase or infrastructure action.
