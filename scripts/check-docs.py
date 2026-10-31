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

    chapters = sorted((ROOT / 'docs/chapters').glob('*.md'))
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
    for path in chapters:
        for dependency in re.findall(r'\*\*Depends on:\*\* (CL-\d{2}-\d{2})', path.read_text()):
            if dependency not in tasks:
                errors.append(f'{path.name}: unknown task dependency {dependency}')

    decisions = list((ROOT / 'docs/architecture/decisions').glob('[0-9]*.md'))
    if len(decisions) < 10:
        errors.append(f'Expected at least 10 baseline ADRs, found {len(decisions)}')
    source = ROOT / 'docs/source/CraftLayer_Build_Blueprint.md'
    if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_HASH:
        errors.append('Original blueprint missing or altered')
    for entry in ('README.md', 'AGENTS.md', 'CLAUDE.md', 'docs/README.md', 'docs/delivery/status.md'):
        if not (ROOT / entry).is_file():
            errors.append(f'Missing entry point: {entry}')

    for error in errors:
        print(f'ERROR: {error}', file=sys.stderr)
    word_count = sum(len(path.read_text().split()) for path in files)
    print(f'{len(files)} Markdown files; {word_count:,} words; '
          f'{len(chapters)} chapters; {len(set(tasks))} task IDs; {len(decisions)} ADRs')
    print('Documentation structure: ' + ('FAIL' if errors else 'PASS'))
    return int(bool(errors))


if __name__ == '__main__':
    raise SystemExit(main())
