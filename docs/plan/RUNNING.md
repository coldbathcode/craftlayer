# How to run the plan

Part of the [master plan](../MASTER_PLAN.md).

## Each step

1. Pick the next step from the [status board](STATUS.md) whose dependencies are done and whose owner decisions are answered. Mark it **In progress**.
2. Build it with tests alongside, following [AGENTS.md](../../AGENTS.md).
3. Run the checks that apply: `pnpm check` always; `pnpm test:db` for database changes; `pnpm test:server-ui` for UI changes; real VPS or game evidence where the step's "done when" says so.
4. Update the status board (state, date, evidence in one line), plus the build log and any affected chapter or runbook.
5. Commit only the step's changes and push to `origin main`. Confirm local and remote match.

A failed check is recorded as failed, not hidden. A step that needs a VPS change says what approval it needs; that approval is asked for before the change and recorded in the private operator record.

## States

| State | Meaning |
| --- | --- |
| Not started | Nothing built |
| Needs decision | Waiting on an owner decision listed on the status board |
| In progress | Being built |
| Built | Code merged, local checks pass, real-world evidence still pending |
| Done | Meets its "done when", including real evidence |
| Blocked | Cannot proceed; reason given |

## Parallel work

Independent tracks can run at the same time (for example C1–C2 alongside A1–A2, and B1 at any time). Only one agent session may operate the VPS at once; check for an active session before touching it.
