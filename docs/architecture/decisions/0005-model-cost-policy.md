# ADR 0005 — Fail-closed model eligibility and atomic budgets

**Status:** proposed engineering default. **Date:** 2026-10-31. **Decision owner:** project owner / implementing chapter reviewer, unassigned until implementation. This document records a recommendation, not reviewed implementation evidence.

## Context

Free-only routing must not silently fall back to paid inference.

## Decision

Require current evidence for all relevant charge dimensions, bounded provider-side behavior and hierarchical reservations. Unknown/stale data blocks hosted dispatch. Paid providers/fallback are disabled by default.

## Alternatives considered

Suffix-based free selection, zero budget UI alone and optimistic post-hoc accounting cannot stop hidden spend. Unconditional local fallback may violate endpoint/privacy policy.

## Consequences and validation

Provider outages can pause work. Explain blocked reasons and distinguish provider invoice from local infrastructure cost. Metadata alone cannot guarantee upstream billing behavior.

## Adoption and reconsideration

Adopt or amend at the owning chapter review. Record evidence and approval date here. Reopen if measured behavior, threat assumptions, compatibility or user direction changes. Update dependent specifications and tests alongside a decision change; do not silently rewrite historical accepted rationale.
