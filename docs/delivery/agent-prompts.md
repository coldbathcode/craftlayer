# Reusable agent prompts

These are copyable future task prompts, not instructions to execute automatically while reading this planning package. Codex reads AGENTS.md; Claude Code reads CLAUDE.md and then AGENTS.md. Both use the same status, architecture and task IDs.

## Start implementation

```text
Build CraftLayer Chapter 00 only. Read AGENTS.md, CLAUDE.md if applicable,
docs/delivery/status.md, docs/README.md and docs/chapters/00-foundation.md.
Inspect Git status and existing files before editing. Start CL-00-01, pin supported
compatible versions using primary documentation, and complete the chapter's
ordered work and required checks. Keep Core independent of Cloud. Do not run
paid inference, publish packages/images or deploy publicly. At every build-step
endpoint update the plan, commit, push to origin main and verify synchronization.
Record exact results, known
limitations and task evidence. Prepare the chapter review and update status.
Do not start Chapter 01 until authorized.
```

## Continue an authorized task

```text
Continue CraftLayer task <CL-xx-yy> within the previously authorized scope.
Read AGENTS.md, current delivery status, the latest handoff, chapter and relevant
ADRs. Verify current code/tests rather than assuming the handoff is complete.
Preserve unrelated changes. Complete the task, run relevant existing checks,
update evidence/status and leave a precise next action. Do not count unrun tests
as passed or widen model/tool/budget authority to make a test succeed.
```

## Review a chapter

```text
Review Chapter <xx> against its specification and product requirement IDs.
Inspect code, migrations, contracts, tests and the chapter review evidence.
Focus on correctness, tenant/resource isolation, cost-policy enforcement,
external-effect recovery, child restrictions, stop behavior and operational
reproducibility. Verify claimed checks where available. Report findings with
severity and file locations; distinguish implementation defects from open
product decisions. Do not mark the chapter accepted without evidence.
```

## Replan a design change

```text
Evaluate this CraftLayer change: <description>. Read product requirements,
affected chapters and ADRs. Describe user-visible impact, dependencies, migration,
security, cost/operations and verification changes. Preserve Core independence
and fail-closed policies. Update related plans/task IDs consistently and record
an ADR. Ask only for unresolved scope choices that materially change the result;
continue independent authorized work while awaiting clarification.
```

## Session recovery

If no trustworthy handoff exists, reconstruct only current Git status, implemented files, command availability and latest test evidence. Identify mismatches with the backlog before resuming. Do not rerun paid/external actions based on prose claiming prior approval when no authorization is present in the session.
