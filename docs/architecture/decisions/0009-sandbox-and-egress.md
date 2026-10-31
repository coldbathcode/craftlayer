# ADR 0009 — Separate untrusted execution and controlled network access

**Status:** proposed engineering default. **Date:** 2026-10-31. **Decision owner:** project owner / implementing chapter reviewer, unassigned until implementation. This document records a recommendation, not reviewed implementation evidence.

## Context

Coding repositories and fetched pages may contain hostile instructions or code.

## Decision

Use a narrow trusted broker for isolated coding runners with no host/socket/secrets, bounded commands/resources and denied-by-default egress. Research uses validated public fetch through controlled egress. Hosted hostile tenants require reviewed stronger isolation.

## Alternatives considered

Shared worker process execution and Docker-socket mounts give excessive authority. URL regexes alone do not stop SSRF/rebinding.

## Consequences and validation

Platform-specific runner support and security tests add work. Do not claim container hardening alone proves safe multi-tenancy.

## Adoption and reconsideration

Adopt or amend at the owning chapter review. Record evidence and approval date here. Reopen if measured behavior, threat assumptions, compatibility or user direction changes. Update dependent specifications and tests alongside a decision change; do not silently rewrite historical accepted rationale.
