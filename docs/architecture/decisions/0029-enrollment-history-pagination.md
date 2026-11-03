# ADR 0029 — Stable chronological enrollment history

Status: adopted for authorized local F2 / REV-06, 2026-11-03. Applies to pending-name history, not verified identity or access.

## Decision

Return enrollment history newest first using `(created_at DESC, id DESC)`. Retain the existing UUID `cursor` and response schema: resolve its immutable row under the current organization/server scope, then compare the full `(created_at,id)` tuple in PostgreSQL. A missing or foreign cursor returns 404. Keep 50-row pages with one extra row to determine continuation. No OFFSET, user-supplied timestamp, out-of-scope anchor or JavaScript timestamp rounding is used.

The server-side anchor preserves PostgreSQL sub-millisecond timestamp precision and deterministic UUID tie-breaking. Later arrivals before the current anchor appear on a fresh first page, without shifting the existing traversal. This is a seek cursor, not a fixed database snapshot; backdated imports or a future deletion/retention policy would need their own compatibility treatment. Current enrollment rows are immutable and retained.

Add SQL 0025 and matching Drizzle index `(organization_id,server_id,created_at DESC,id DESC)`. Equality scope precedes the ordered range; existing expiry/budget indexes remain because their access pattern differs. No grants, RLS, existing migration or historical record changes. Pre-management upgrade fixtures omit this index until the enrollment table exists.

## Compatibility and evidence

HTTP/SDK request and response types remain unchanged. The display/traversal order changes from random UUID order to chronology. Clients must restart pagination from the first page after upgrading or rolling back; do not combine pages from different ordering versions. Original request receipt replay and metadata deduplication are unaffected. Exact parsed names remain unverified and cannot grant game access.

Disposable database tests traverse 101 retained rows over three pages with equal timestamps containing microseconds beyond JavaScript Date precision, insert a newer request between pages, prove exact once-per-traversal IDs and fresh-first-page visibility, and deny foreign-server/tenant cursors. Test fixture rows are synthetic metadata only. The migration passes fresh/repeat/upgrade/rollback/checksum checks; final command results are in the build log.

## Rollback and limits

An application rollback can retain the additive index and all history; restart pagination after switching order. No destructive rollback or production migration is authorized here. Audit/retention, authenticated identity resolution, explicit withdrawal, real allowlists and backup/restore remain separate work. This checkpoint does not complete F2 or certify a family deployment.
