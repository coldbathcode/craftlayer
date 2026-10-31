# GitHub repository and optional Project board setup

Status: local Git only. The user will create the GitHub repository named `craftlayer`. No remote URL or account owner has been assumed.

## Attach the repository

Create an empty repository without a generated README, .gitignore or license so its initial history does not conflict with this planning commit. Choose visibility deliberately: the license is still a candidate and domain/trademark checks are unresolved. Do not infer permission to publish from local initialization.

From the local `craftlayer` directory, after replacing the placeholder with the real Git URL and authorizing the push:

```bash
git status --short --branch
git log -1 --oneline
git remote add origin <YOUR_GITHUB_CRAFTLAYER_GIT_URL>
git push -u origin main
```

If `origin` already exists, inspect `git remote -v` first instead of overwriting it. Do not force-push to reconcile a generated remote commit; inspect and reconcile history explicitly. These are setup instructions, not commands already run.

## Repository settings after code begins

- Use `main` as default branch. Enable review/protection for release changes and required CI checks after those workflows actually exist.
- Keep Actions tokens least-privileged; external PRs have no provider/deployment credentials.
- Enable secret/dependency scanning where available. Document vulnerability triage and avoid treating a scanner checkbox as the complete security gate.
- Add the chosen license and actual contribution/code of conduct/security policies before public release, with real maintainer contacts.
- Do not configure deployment, registry publishing or paid CI resources without scope authorization.

## Optional GitHub Projects board

A repository and a GitHub Project board are separate. If a board is desired, suggested fields are Status, Chapter, Milestone, Area, Risk, Size, Dependencies and Evidence. Suggested statuses: Backlog, Ready, In progress, Blocked, Implemented, Verified, Accepted.

Use one chapter epic per chapter and one linked task issue per `CL-xx-yy`. Create Core chapters first; Chapter 11 issues belong in a future separate Cloud repo. Labels: `chapter:00` through `chapter:11`, `area:auth`, `area:runtime`, `area:providers`, `area:minecraft`, `area:web`, `area:sandbox`, `area:ops`, `security`, `decision`, `blocked`, `cloud-optional`.

Import task title, dependencies, implementation text, required evidence, chapter security criteria and acceptance links. Preserve task IDs in issue titles and commits for traceability. Do not mass-create GitHub issues or a board during this handoff; the repository does not yet exist and no external write is authorized here.

Use [the task template](../templates/engineering-task.md) and keep checked-in status aligned with the board. Avoid fake target dates before compatibility/sandbox spikes establish effort.
