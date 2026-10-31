# ADR 0006 — Structured AI plans and deterministic environment actions

**Status:** proposed engineering default. **Date:** 2026-10-31. **Decision owner:** project owner / implementing chapter reviewer, unassigned until implementation. This document records a recommendation, not reviewed implementation evidence.

## Context

Model output and external observations are untrusted, and Minecraft success is observable.

## Decision

Models propose bounded schema-validated DAG/tool arguments. The runtime authorizes actions and adapters execute deterministic, verified primitives. Use bounded typed blackboard memory.

## Alternatives considered

Unrestricted agent chat/shell/game commands increase cost and authority ambiguity. Pure model self-evaluation cannot verify external outcomes.

## Consequences and validation

More action libraries and verifiers are needed. Evaluate actual world/diff/source outcomes and reject invalid plans after a small bounded repair budget.

## Adoption and reconsideration

Adopt or amend at the owning chapter review. Record evidence and approval date here. Reopen if measured behavior, threat assumptions, compatibility or user direction changes. Update dependent specifications and tests alongside a decision change; do not silently rewrite historical accepted rationale.
