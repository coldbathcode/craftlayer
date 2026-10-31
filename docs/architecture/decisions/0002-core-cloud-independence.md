# ADR 0002 — Core independence and separate commercial service

**Status:** proposed engineering default. **Date:** 2026-10-31. **Decision owner:** project owner / implementing chapter reviewer, unassigned until implementation. This document records a recommendation, not reviewed implementation evidence.

## Context

Self-hosted usefulness is the primary product promise.

## Decision

Keep Cloud in a separate repository/deployment consuming public versioned Core packages/APIs. Local identity, execution, backup and upgrades have no Cloud account/entitlement dependency.

## Alternatives considered

A single feature-flagged commercial codebase can accidentally introduce license-service or hosted-identity coupling. A private fork creates divergence.

## Consequences and validation

Requires intentional public contract/release management. Test disconnected Core and one-way package dependencies before each relevant release.

## Adoption and reconsideration

Adopt or amend at the owning chapter review. Record evidence and approval date here. Reopen if measured behavior, threat assumptions, compatibility or user direction changes. Update dependent specifications and tests alongside a decision change; do not silently rewrite historical accepted rationale.
