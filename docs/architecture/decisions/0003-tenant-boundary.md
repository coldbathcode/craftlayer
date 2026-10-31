# ADR 0003 — Application scope plus PostgreSQL tenant integrity

**Status:** proposed engineering default. **Date:** 2026-10-31. **Decision owner:** project owner / implementing chapter reviewer, unassigned until implementation. This document records a recommendation, not reviewed implementation evidence.

## Context

Every execution surface must deny cross-organization access, including background work.

## Decision

Use authenticated context, scoped repositories, composite tenant foreign keys and RLS with non-owner runtime roles. Transaction-local context prevents pooled-connection leakage. Instance maintenance uses explicit privileged paths.

## Alternatives considered

Application filters alone have a broad omission risk. Database-per-org by default is operationally heavy for local multi-org use; it may be a later Cloud isolation tier.

## Consequences and validation

RLS is defense in depth and not a substitute for authorization or SQL injection defenses. Integration tests must use actual least-privileged roles and pooled context reuse.

## Adoption and reconsideration

Adopt or amend at the owning chapter review. Record evidence and approval date here. Reopen if measured behavior, threat assumptions, compatibility or user direction changes. Update dependent specifications and tests alongside a decision change; do not silently rewrite historical accepted rationale.
