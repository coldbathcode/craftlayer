# GitHub repository and optional Project board setup

Status: the user created [coldbathcode/craftlayer](https://github.com/coldbathcode/craftlayer). The local repository is connected as `origin`, and the planning commits are published to `main`. A GitHub Project board has not been created.

## Work with the repository

For a new checkout:

```bash
git clone https://github.com/coldbathcode/craftlayer.git
cd craftlayer
```

To inspect and push authorized changes from the existing checkout:

```bash
git status --short --branch
git remote -v
git log -1 --oneline
git push origin main
```

Commit the intended changes before pushing. Do not force-push or overwrite a remote without inspecting its history and obtaining authorization for destructive changes. The initial remote was verified empty before the planning history was pushed.

## Repository settings after code begins

- Use `main` as default branch. Enable review/protection for release changes and required CI checks after those workflows actually exist.
- Keep Actions tokens least-privileged; external PRs have no provider/deployment credentials.
- Enable secret/dependency scanning where available. Document vulnerability triage and avoid treating a scanner checkbox as the complete security gate.
- Add the chosen license and actual contribution/code of conduct/security policies before public release, with real maintainer contacts.
- Do not configure deployment, registry publishing or paid CI resources without scope authorization.

## Optional GitHub Projects board

A repository and a GitHub Project board are separate. If a board is desired, suggested fields are Status, Chapter, Milestone, Area, Risk, Size, Dependencies and Evidence. Suggested statuses: Backlog, Ready, In progress, Blocked, Implemented, Verified, Accepted.

Use one chapter epic per chapter and one linked task issue per `CL-xx-yy`. Create Core chapters first; Chapter 11 issues belong in a future separate Cloud repo. Labels: `chapter:00` through `chapter:11`, `area:auth`, `area:runtime`, `area:providers`, `area:minecraft`, `area:web`, `area:sandbox`, `area:ops`, `security`, `decision`, `blocked`, `cloud-optional`.

Import task title, dependencies, implementation text, required evidence, chapter security criteria and acceptance links. Preserve task IDs in issue titles and commits for traceability. Issue creation and a Project board are separate optional work; the authorization to commit and push the planning repository does not request creating them.

Use [the task template](../templates/engineering-task.md) and keep checked-in status aligned with the board. Avoid fake target dates before compatibility/sandbox spikes establish effort.
