# ADR 0007 — Latched stop, leases and explicit resume

**Status:** proposed engineering default. **Date:** 2026-10-31. **Decision owner:** project owner / implementing chapter reviewer, unassigned until implementation. This document records a recommendation, not reviewed implementation evidence.

## Context

A disconnected worker or restarted process must not silently continue unsafe work.

## Decision

Persist scope stop epochs/latches, reject new dispatch, notify workers, enforce local watchdog/action deadlines and report quiescence separately from request acceptance. Clearing stop does not auto-resume.

## Alternatives considered

In-memory stop flags disappear on restart. Queue cancellation does not stop active physical effects. UI-only stop status is misleading.

## Consequences and validation

Short leases reduce availability during outages and require careful cancellation. Measure partition behavior and preserve uncertain effect status until reconciled.

## Adoption and reconsideration

Adopt or amend at the owning chapter review. Record evidence and approval date here. Reopen if measured behavior, threat assumptions, compatibility or user direction changes. Update dependent specifications and tests alongside a decision change; do not silently rewrite historical accepted rationale.
