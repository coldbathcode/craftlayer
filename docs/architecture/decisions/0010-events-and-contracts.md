# ADR 0010 — Versioned contracts and authorized resumable events

**Status:** proposed engineering default. **Date:** 2026-10-31. **Decision owner:** project owner / implementing chapter reviewer, unassigned until implementation. This document records a recommendation, not reviewed implementation evidence.

## Context

Dashboard/CLI/workers must recover from reconnects without leaking tenant data.

## Decision

Use versioned Zod/OpenAPI contracts, typed SDK, scoped durable event cursors, at-least-once delivery, client deduplication and explicit resync after retention gaps.

## Alternatives considered

Best-effort unscoped pub/sub loses state and can leak channels. Handwritten clients drift. Unlimited event replay/buffers exhaust memory.

## Consequences and validation

Requires snapshot/replay boundaries, retention and schema compatibility tests. Authorization changes must invalidate active stream projections.

## Adoption and reconsideration

Adopt or amend at the owning chapter review. Record evidence and approval date here. Reopen if measured behavior, threat assumptions, compatibility or user direction changes. Update dependent specifications and tests alongside a decision change; do not silently rewrite historical accepted rationale.
