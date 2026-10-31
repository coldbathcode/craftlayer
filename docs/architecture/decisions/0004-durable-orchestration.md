# ADR 0004 — PostgreSQL authority, outbox and at-least-once queue

**Status:** proposed engineering default. **Date:** 2026-10-31. **Decision owner:** project owner / implementing chapter reviewer, unassigned until implementation. This document records a recommendation, not reviewed implementation evidence.

## Context

Task delivery and external actions can be interrupted at any boundary.

## Decision

Persist state/attempts/leases/fences/outbox in PostgreSQL; use BullMQ for dispatch. Reconcile uncertain effects before retry and accept repeated messages.

## Alternatives considered

Redis-only durable mission state complicates recovery. A full workflow framework adds complexity before requirements justify it. Queue job IDs cannot prove exactly-once physical effects.

## Consequences and validation

Additional transactions/recovery code are required. Test kill points and stale clients, not only normal completion.

## Adoption and reconsideration

Adopt or amend at the owning chapter review. Record evidence and approval date here. Reopen if measured behavior, threat assumptions, compatibility or user direction changes. Update dependent specifications and tests alongside a decision change; do not silently rewrite historical accepted rationale.
