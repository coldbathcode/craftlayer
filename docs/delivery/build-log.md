# Build log

Every entry records an independently committed/pushed build step on `main`. Exact commits are available with `git log --oneline --grep=CL-00`.

## CL-00-01 — 2026-10-31

Pinned local Node/pnpm and selected exact library versions in ADR 0011. Inspected official multi-architecture image indexes and stored immutable digests. `node --version`, `pnpm --version`, package metadata and image manifest checks passed. Application install/build checks belong to CL-00-02 onward; Minecraft authentication and amd64 execution remain unverified. Added the standing plan-update/commit/push requirement to both agent entry points.
