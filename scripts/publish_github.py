#!/usr/bin/env python3
"""Create the public repository and resumably publish real GitHub sub-issues.

Dry run is the default. Uses existing gh authentication, never reads tokens.
On failure, rerun: stable body markers avoid duplicate issues, including closed ones.
"""
import argparse
import json
import re
import subprocess
import sys
import time

from validate_backlog import ROOT, validate


def command(args, input_text=None):
    result = subprocess.run(args, cwd=ROOT, input=input_text, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result.stdout


def api(path, method='GET', body=None, paginate=False):
    args = ['gh', 'api', path, '--method', method, '-H', 'Accept: application/vnd.github+json',
            '-H', 'X-GitHub-Api-Version: 2026-03-10']
    if paginate:
        args.extend(['--paginate', '--slurp'])
    if body is not None:
        args.extend(['--input', '-'])
    # Space mutations to avoid GitHub secondary content-creation limits.
    if method != 'GET':
        time.sleep(1.1)
    output = command(args, json.dumps(body) if body is not None else None)
    result = json.loads(output) if output.strip() else None
    return [item for page in result for item in page] if paginate else result


def get_repo_or_missing(repo):
    # A 404 is the only condition that permits attempting creation. Auth/network
    # failures must not be treated as an absent repository.
    try:
        return api(f'repos/{repo}')
    except RuntimeError as error:
        if '(HTTP 404)' in str(error):
            return None
        raise


def marker(key):
    return f'<!-- pagelet:key={key} -->'


def managed_body(item, epic=None, index=None):
    index = index or {}
    lines = [marker(item['key']), '<!-- pagelet:managed:start -->',
             '## Outcome', '', item['outcome'], '',
             f"**Milestone:** {item['milestone']}", '']
    if epic:
        parent = index.get(epic['key'])
        parent_ref = f"#{parent['number']}" if parent else epic['key']
        lines.extend([f'**Epic:** {parent_ref}',
                      f"**Priority:** {item['priority']} · **Size:** {item['size']} · **Area:** {item['area']}",
                      '', '## Acceptance criteria', ''])
        lines.extend(f'- [ ] {criterion}' for criterion in item['acceptance'])
        lines.extend(['', '## Verification', '', item['verification'], '', '## Dependencies', ''])
        for key in item['depends_on']:
            ref = f"#{index[key]['number']}" if key in index else key
            lines.append(f'- {ref} ({key})')
        if not item['depends_on']:
            lines.append('No story dependencies.')
    else:
        lines.extend(['## Child stories', ''])
        for child in item['issues']:
            ref = f"#{index[child['key']]['number']}" if child['key'] in index else child['key']
            lines.append(f"- [ ] {ref} — {child['title']}")
        lines.extend(['', '## Completion criteria', '',
                      'All child stories meet their acceptance criteria and verification requirements. '
                      'Publishing this plan does not complete implementation.'])
    lines.extend(['', '## References', '',
                  'See docs/PRODUCT.md, docs/ARCHITECTURE.md, docs/DESIGN.md and docs/ROADMAP.md in this repository.',
                  '', '<!-- pagelet:managed:end -->'])
    return '\n'.join(lines)


def merge_managed(old, new):
    pattern = r'<!-- pagelet:key=[A-Z0-9]+ -->\s*<!-- pagelet:managed:start -->.*?<!-- pagelet:managed:end -->'
    if not re.search(pattern, old, flags=re.S):
        raise RuntimeError('Existing issue marker has no managed block; refusing to overwrite its body.')
    return re.sub(pattern, lambda _: new, old, count=1, flags=re.S)


def issue_index(issues):
    index = {}
    for issue in issues:
        if 'pull_request' in issue:
            continue
        match = re.search(r'<!-- pagelet:key=([A-Z0-9]+) -->', issue.get('body') or '')
        if match:
            key = match.group(1)
            if key in index:
                raise RuntimeError(f'Duplicate remote marker {key}; resolve it before publishing.')
            index[key] = issue
    return index


def publish(data, push=False, issues_only=False):
    config = data['repository']
    repo = f"{config['owner']}/{config['name']}"
    meta = get_repo_or_missing(repo)
    if not meta:
        if issues_only:
            raise RuntimeError(f'{repo} must exist before issues-only publication.')
        login = api('user')['login']
        if login.lower() != config['owner'].lower():
            raise RuntimeError(f'Expected authenticated owner {config["owner"]}; found {login}.')
        command(['gh', 'repo', 'create', repo, '--public', '--description', config['description']])
        meta = api(f'repos/{repo}')
    if meta['private']:
        raise RuntimeError('The target repository is private; refusing to expose existing private content.')
    if not issues_only:
        api(f'repos/{repo}', 'PATCH', dict(description=config['description'], homepage=config['homepage'],
                                         has_issues=True, has_wiki=False))
        api(f'repos/{repo}/topics', 'PUT', {'names': config['topics']})
    if push:
        if command(['git', 'status', '--porcelain']).strip():
            raise RuntimeError('Commit the prepared files before using --push.')
        remotes = command(['git', 'remote']).splitlines()
        expected = f'https://github.com/{repo}.git'
        if 'origin' not in remotes:
            command(['git', 'remote', 'add', 'origin', expected])
        else:
            existing = command(['git', 'remote', 'get-url', 'origin']).strip()
            if existing not in {expected, f'git@github.com:{repo}.git'}:
                raise RuntimeError(f'Unexpected origin: {existing}; refusing to push.')
        if command(['git', 'branch', '--show-current']).strip() != 'main':
            raise RuntimeError('Expected the prepared main branch before pushing.')
        command(['git', 'push', '-u', 'origin', 'main'])  # never force

    labels = {'epic': ('244ACC', 'Pagelet parent epic'), 'story': ('D7EDE7', 'Implementation story'),
              'P0': ('B33A3A', 'Required for safe release'), 'P1': ('5774BE', 'Planned feature scope')}
    for area in sorted({i['area'] for e in data['epics'] for i in e['issues']}):
        labels[f'area:{area}'] = ('E4DDFA', f'{area} work')
    existing_labels = {x['name']: x for x in api(f'repos/{repo}/labels?per_page=100', paginate=True)}
    for name, (color, description) in labels.items():
        if name not in existing_labels:
            api(f'repos/{repo}/labels', 'POST', dict(name=name, color=color, description=description))
    milestones = {m['title']: m for m in api(f'repos/{repo}/milestones?state=all&per_page=100', paginate=True)}
    for milestone in data['milestones']:
        if milestone['title'] not in milestones:
            milestones[milestone['title']] = api(f'repos/{repo}/milestones', 'POST', milestone)

    index = issue_index(api(f'repos/{repo}/issues?state=all&per_page=100', paginate=True))
    pairs = [(epic, None) for epic in data['epics']]
    pairs += [(story, epic) for epic in data['epics'] for story in epic['issues']]
    for item, parent in pairs:
        key = item['key']
        if key not in index:
            title = f"[{key}] {item['title']}"
            tags = ['story', item['priority'], f"area:{item['area']}"] if parent else ['epic']
            index[key] = api(f'repos/{repo}/issues', 'POST', dict(
                title=title, body=managed_body(item, parent, index), labels=tags,
                milestone=milestones[item['milestone']]['number']))
            print(f"Created {key}: {index[key]['html_url']}", flush=True)

    # Replace only the generated block, preserving human notes and issue state.
    for item, parent in pairs:
        remote = index[item['key']]
        body = merge_managed(remote['body'], managed_body(item, parent, index))
        required = {'story', item['priority'], f"area:{item['area']}"} if parent else {'epic'}
        tags = sorted(required | {label['name'] for label in remote['labels']})
        milestone_number = milestones[item['milestone']]['number']
        if body != remote['body'] or set(tags) != {x['name'] for x in remote['labels']} or (remote.get('milestone') or {}).get('number') != milestone_number:
            index[item['key']] = api(f"repos/{repo}/issues/{remote['number']}", 'PATCH',
                                    dict(body=body, labels=tags, milestone=milestone_number))

    for epic in data['epics']:
        parent = index[epic['key']]
        path = f"repos/{repo}/issues/{parent['number']}/sub_issues"
        linked = {c['id'] for c in api(path + '?per_page=100', paginate=True)}
        for story in epic['issues']:
            child = index[story['key']]
            if child['id'] not in linked:
                # No replace_parent: a conflicting parent must fail visibly.
                api(path, 'POST', {'sub_issue_id': child['id']})
        verified = {c['id'] for c in api(path + '?per_page=100', paginate=True)}
        expected = {index[c['key']]['id'] for c in epic['issues']}
        if not expected <= verified:
            raise RuntimeError(f"Native child verification failed for {epic['key']}")
        print(f"Verified {epic['key']}: {len(expected)} native sub-issues", flush=True)

    final = api(f'repos/{repo}')
    if final['private'] or (not issues_only and final['description'] != config['description']):
        raise RuntimeError('Repository metadata verification failed.')
    if not issues_only and not set(config['topics']) <= set(final.get('topics', [])):
        raise RuntimeError('Repository topic verification failed.')
    published = issue_index(api(f'repos/{repo}/issues?state=all&per_page=100', paginate=True))
    if not {item['key'] for item, _ in pairs} <= published.keys():
        raise RuntimeError('Final issue verification failed.')
    state = {'repository': repo, 'verified': True,
             'issues': {key: {'number': value['number'], 'url': value['html_url']} for key, value in published.items()}}
    (ROOT / '.pagelet-publish-state.json').write_text(json.dumps(state, indent=2) + '\n')
    print(f'Verified {len(pairs)} issues with native parent/child links: https://github.com/{repo}/issues')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Create/update GitHub resources (default: dry run)')
    parser.add_argument('--push', action='store_true', help='Also push the clean local main branch, without force')
    parser.add_argument('--issues-only', action='store_true', help='Existing repo: publish labels/milestones/issues only')
    args = parser.parse_args()
    data = json.loads((ROOT / 'docs/backlog.json').read_text())
    epics, stories = validate(data)
    config = data['repository']
    print(f"Plan: public {config['owner']}/{config['name']}; {epics} epics; {stories} child stories; {len(data['milestones'])} milestones.")
    if not args.apply:
        print('Dry run only. Use --apply to publish; add --push to upload the committed repository files.')
        return
    publish(data, push=args.push, issues_only=args.issues_only)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, AssertionError) as error:
        print(f'Publication stopped: {error}', file=sys.stderr)
        sys.exit(1)
