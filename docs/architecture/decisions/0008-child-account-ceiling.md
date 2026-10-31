# ADR 0008 — Adult-managed child identities and immutable approved presets

**Status:** proposed engineering default. **Date:** 2026-10-31. **Decision owner:** project owner / implementing chapter reviewer, unassigned until implementation. This document records a recommendation, not reviewed implementation evidence.

## Context

Child users need a simple experience with a strict upper bound on actions.

## Decision

Account-type restrictions intersect role grants. Adult approves exact preset version/world/capabilities. Child launches assigned Minecraft presets and can stop permitted bots, but cannot access credentials/code/research/player attacks.

## Alternatives considered

Hiding admin navigation alone leaves API/CLI bypasses. General-purpose chat inputs are difficult to constrain. Role union must not remove child restrictions.

## Consequences and validation

Requires dedicated positive/negative journeys and sanitized events. Collect minimal personal data and keep account recovery adult-managed.

## Adoption and reconsideration

Adopt or amend at the owning chapter review. Record evidence and approval date here. Reopen if measured behavior, threat assumptions, compatibility or user direction changes. Update dependent specifications and tests alongside a decision change; do not silently rewrite historical accepted rationale.
