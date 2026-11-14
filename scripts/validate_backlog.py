#!/usr/bin/env python3
"""Validate roadmap references and detect dependency cycles without dependencies."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def validate(data):
    milestones = {m['title'] for m in data['milestones']}
    seen = set()
    stories = {}
    for epic in data['epics']:
        assert epic['key'] not in seen, f"Duplicate key: {epic['key']}"
        seen.add(epic['key'])
        assert epic['milestone'] in milestones
        assert epic['issues'], f"Empty epic: {epic['key']}"
        for story in epic['issues']:
            key = story['key']
            assert key not in seen, f'Duplicate key: {key}'
            seen.add(key)
            stories[key] = story
            assert len(story['acceptance']) >= 3, f'Missing criteria: {key}'
            assert story['verification'] and story['outcome'] and story['title']
            assert story['milestone'] in milestones
            assert story['priority'] in {'P0', 'P1', 'P2'}
            assert story['size'] in {'S', 'M', 'L'}
    visiting, visited = set(), set()

    def visit(key):
        assert key in stories, f'Unknown dependency: {key}'
        assert key not in visiting, f'Dependency cycle at {key}'
        if key in visited:
            return
        visiting.add(key)
        for dependency in stories[key]['depends_on']:
            visit(dependency)
        visiting.remove(key)
        visited.add(key)

    for key in stories:
        visit(key)
    return len(data['epics']), len(stories)


if __name__ == '__main__':
    data = json.loads((ROOT / 'docs/backlog.json').read_text())
    epics, stories = validate(data)
    print(f'Valid: {epics} epics, {stories} stories; all dependencies resolve without cycles.')
