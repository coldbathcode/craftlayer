# ADR 0001 — TypeScript monorepo and explicit package boundaries

**Status:** proposed engineering default. **Date:** 2026-10-31. **Decision owner:** project owner / implementing chapter reviewer, unassigned until implementation. This document records a recommendation, not reviewed implementation evidence.

## Context

A small team needs shared contracts and rapid iteration without runtime/framework coupling.

## Decision

Use pnpm + strict TypeScript, Fastify/Zod/OpenAPI, Next.js, Drizzle/PostgreSQL, Redis/BullMQ and Pino as the blueprint baseline. Select supported compatible versions in Chapter 00. Keep domain packages framework-independent.

## Alternatives considered

Polyglot microservices increase operations/contracts burden before evidence of need. A single Next-only service blurs worker and web security boundaries. A general agent framework is deferred.

## Consequences and validation

One language improves reuse, but type safety does not replace runtime validation. More packages require dependency checks. Revisit when profiling or deployment constraints show a concrete need.

## Adoption and reconsideration

Adopt or amend at the owning chapter review. Record evidence and approval date here. Reopen if measured behavior, threat assumptions, compatibility or user direction changes. Update dependent specifications and tests alongside a decision change; do not silently rewrite historical accepted rationale.
