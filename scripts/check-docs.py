#!/usr/bin/env python3
"""Check the planning baseline using only the Python standard library.

Update expected IDs/counts deliberately when the approved plan changes.
This checks documentation structure, not application correctness or security.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE_HASH = '97a94d4e2b69ec79b8fbf885f68213f8724313d438e29089357e99195b1bb8d2'
LINK = re.compile(r'\[[^\]\n]*\]\(([^)\n]+)\)')
TASK = re.compile(r'^### \[[ x]\] (CL-\d{2}-\d{2}) —', re.MULTILINE)
BACKLOG_TASK = re.compile(r'^\| \[(CL-\d{2}-\d{2})\]', re.MULTILINE)
MANAGEMENT_TASK = re.compile(r'^### \[[ x]\] (CL-F(?:0|1|2|25|3)-\d{2}) —', re.MULTILINE)
MANAGEMENT_BACKLOG_TASK = re.compile(r'^\| \[(CL-F(?:0|1|2|25|3)-\d{2})\]', re.MULTILINE)
MANAGEMENT_CHAPTERS = {
    'F0-preflight.md': ('F0', 2),
    'F1-control-plane.md': ('F1', 3),
    'F2-family-access.md': ('F2', 4),
    'F2.5-docker-provisioning.md': ('F25', 5),
    'F3-server-operations.md': ('F3', 2),
}
CHAPTER_SECTIONS = (
    'Objective', 'Dependencies and entry gate', 'Ordered engineering tasks',
    'Test plan', 'Security considerations', 'Acceptance criteria',
    'Documentation and deliverables', 'Review checkpoint and next handoff',
)


def main() -> int:
    errors: list[str] = []
    # Use tracked planning roots rather than traversing future node_modules/builds.
    files = sorted([*ROOT.glob('*.md'), *(ROOT / 'docs').rglob('*.md')])
    for path in files:
        content = path.read_text()
        name = path.relative_to(ROOT)
        if not content.endswith('\n'):
            errors.append(f'{name}: missing final newline')
        if content.count('```') % 2:
            errors.append(f'{name}: unbalanced triple-backtick fences')
        for match in LINK.finditer(content):
            target = match.group(1).strip().strip('<>')
            if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith('#'):
                continue
            destination = target.split('#', 1)[0]
            if destination and not (path.parent / destination).is_file():
                errors.append(f'{name}: missing file link {destination}')

    all_chapters = sorted((ROOT / 'docs/chapters').glob('*.md'))
    chapters = [path for path in all_chapters if re.match(r'^\d{2}-', path.name)]
    management_chapters = [path for path in all_chapters if path not in chapters]
    if len(chapters) != 12:
        errors.append(f'Expected 12 chapters, found {len(chapters)}')
    tasks: list[str] = []
    for number, path in enumerate(chapters):
        content = path.read_text()
        if not path.name.startswith(f'{number:02d}-'):
            errors.append(f'Unexpected chapter sequence: {path.name}')
        identifiers = TASK.findall(content)
        expected = [f'CL-{number:02d}-{task:02d}' for task in range(1, 8)]
        if identifiers != expected:
            errors.append(f'{path.name}: unexpected task IDs or ordering')
        tasks.extend(identifiers)
        for section in CHAPTER_SECTIONS:
            if f'## {section}' not in content:
                errors.append(f'{path.name}: missing {section}')

    backlog_path = ROOT / 'docs/delivery/backlog.md'
    if not backlog_path.is_file():
        errors.append('Missing engineering backlog')
    elif BACKLOG_TASK.findall(backlog_path.read_text()) != tasks:
        errors.append('Backlog IDs/order differ from chapter IDs/order')
    if len(tasks) != 84 or len(set(tasks)) != 84:
        errors.append('Expected 84 unique tasks')
    if {path.name for path in management_chapters} != set(MANAGEMENT_CHAPTERS):
        errors.append('Management chapter files differ from the F0–F3 plan')
    management_tasks: list[str] = []
    for filename, (phase, count) in MANAGEMENT_CHAPTERS.items():
        path = ROOT / 'docs/chapters' / filename
        if not path.is_file():
            continue
        content = path.read_text()
        identifiers = MANAGEMENT_TASK.findall(content)
        expected = [f'CL-{phase}-{task:02d}' for task in range(1, count + 1)]
        if identifiers != expected:
            errors.append(f'{filename}: unexpected management task IDs or ordering')
        management_tasks.extend(identifiers)
        for section in (*CHAPTER_SECTIONS, 'Rollback and backup'):
            if f'## {section}' not in content:
                errors.append(f'{filename}: missing {section}')
    track = ROOT / 'docs/delivery/minecraft-track.md'
    if not track.is_file() or MANAGEMENT_BACKLOG_TASK.findall(track.read_text()) != management_tasks:
        errors.append('Minecraft track IDs/order differ from management chapters')
    if len(management_tasks) != 16 or len(set(management_tasks)) != 16:
        errors.append('Expected 16 unique management tasks')
    for path in all_chapters:
        for dependency in re.findall(r'\*\*Depends on:\*\* (CL-[A-Z0-9]+-\d{2})', path.read_text()):
            if dependency not in tasks + management_tasks:
                errors.append(f'{path.name}: unknown task dependency {dependency}')

    decisions = list((ROOT / 'docs/architecture/decisions').glob('[0-9]*.md'))
    if len(decisions) < 10:
        errors.append(f'Expected at least 10 baseline ADRs, found {len(decisions)}')
    source = ROOT / 'docs/source/CraftLayer_Build_Blueprint.md'
    if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_HASH:
        errors.append('Original blueprint missing or altered')
    for entry in ('README.md', 'AGENTS.md', 'CLAUDE.md', 'docs/README.md', 'docs/delivery/status.md',
                  'docs/delivery/unified-reconciliation.md', 'docs/delivery/minecraft-track.md',
                  'docs/architecture/minecraft-management.md',
                  'docs/architecture/decisions/0015-unified-control-plane.md',
                  'docs/architecture/decisions/0016-node-provisioning-boundary.md',
                  'docs/security/THREAT_MODEL.md', 'docs/security/DEPLOYMENT_CHECKLIST.md',
                  'docs/operations/minecraft-preservation.md', 'docs/testing/minecraft-management.md'):
        if not (ROOT / entry).is_file():
            errors.append(f'Missing entry point: {entry}')

    for error in errors:
        print(f'ERROR: {error}', file=sys.stderr)
    word_count = sum(len(path.read_text().split()) for path in files)
    print(f'{len(files)} Markdown files; {word_count:,} words; '
          f'{len(chapters)} original + {len(management_chapters)} management chapters; '
          f'{len(set(tasks))} original + {len(set(management_tasks))} management task IDs; '
          f'{len(decisions)} ADRs')
    print('Documentation structure: ' + ('FAIL' if errors else 'PASS'))
    return int(bool(errors))


if __name__ == '__main__':
    raise SystemExit(main())
