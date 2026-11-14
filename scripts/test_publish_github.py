"""Publication safety and resumability tests; all GitHub calls are in memory."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import publish_github as publisher
from validate_backlog import validate


class FakeGitHub:
    def __init__(self, data):
        self.repo = data['repository']
        self.labels = []
        self.milestones = []
        self.issues = []
        self.children = {}
        self.links = []

    def api(self, path, method='GET', body=None, paginate=False):
        base = f"repos/{self.repo['owner']}/{self.repo['name']}"
        route = path.removeprefix(base).split('?')[0]
        if route == '':
            if method == 'PATCH':
                self.repo.update(body)
            return dict(private=False, description=self.repo['description'], topics=self.repo['topics'])
        if route == '/topics':
            self.repo['topics'] = body['names']
            return {}
        if route == '/labels':
            if method == 'POST':
                self.labels.append(copy.deepcopy(body))
            return copy.deepcopy(self.labels)
        if route == '/milestones':
            if method == 'POST':
                milestone = dict(body, number=len(self.milestones) + 1)
                self.milestones.append(milestone)
                return copy.deepcopy(milestone)
            return copy.deepcopy(self.milestones)
        if route == '/issues':
            if method == 'POST':
                number = len(self.issues) + 1
                issue = dict(body, number=number, id=10000 + number, state='open',
                             html_url=f'https://github.com/kasuken/Pagelet/issues/{number}')
                issue['labels'] = [{'name': name} for name in body['labels']]
                issue['milestone'] = {'number': body['milestone']}
                self.issues.append(issue)
                return copy.deepcopy(issue)
            return copy.deepcopy(self.issues)
        parts = route.strip('/').split('/')
        if len(parts) >= 2 and parts[0] == 'issues':
            issue = next(i for i in self.issues if i['number'] == int(parts[1]))
            if len(parts) == 3 and parts[2] == 'sub_issues':
                children = self.children.setdefault(issue['number'], [])
                if method == 'POST':
                    child_id = body['sub_issue_id']
                    if child_id < 10000:
                        raise AssertionError('Sub-issue endpoint requires database ID, not issue number')
                    if any(child_id in ids for ids in self.children.values()):
                        raise RuntimeError('Child already has a parent')
                    children.append(child_id)
                    self.links.append((issue['number'], child_id))
                return [{'id': child_id} for child_id in children]
            if method == 'PATCH':
                issue.update(body)
                issue['labels'] = [{'name': name} for name in body['labels']]
                issue['milestone'] = {'number': body['milestone']}
                return copy.deepcopy(issue)
        raise AssertionError(f'Unexpected API request: {method} {path}')


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((publisher.ROOT / 'docs/backlog.json').read_text())

    def test_full_publication_and_rerun_preserve_notes_state_and_native_links(self):
        github = FakeGitHub(copy.deepcopy(self.data))
        with tempfile.TemporaryDirectory() as folder, patch.object(publisher, 'ROOT', Path(folder)), \
             patch.object(publisher, 'api', side_effect=github.api), patch('builtins.print'):
            publisher.publish(self.data)
            self.assertEqual(len(github.issues), 59)
            self.assertEqual(len(github.links), 48)
            self.assertEqual(len(github.children), 11)
            self.assertEqual(len(github.milestones), 4)
            first = github.issues[0]
            first['body'] += '\n\nHuman note: keep this context.'
            first['state'] = 'closed'
            publisher.publish(self.data)
            self.assertEqual(len(github.issues), 59)
            self.assertEqual(len(github.links), 48)
            self.assertEqual(first['state'], 'closed')
            self.assertTrue(first['body'].endswith('Human note: keep this context.'))
            receipt = json.loads((Path(folder) / '.pagelet-publish-state.json').read_text())
            self.assertTrue(receipt['verified'])

    def test_resume_after_partial_publication_does_not_duplicate(self):
        github = FakeGitHub(copy.deepcopy(self.data))
        calls = 0

        def interrupted(path, method='GET', body=None, paginate=False):
            nonlocal calls
            if method == 'POST' and path.endswith('/issues'):
                calls += 1
                if calls == 15:
                    raise RuntimeError('Simulated network interruption')
            return github.api(path, method, body, paginate)

        with tempfile.TemporaryDirectory() as folder, patch.object(publisher, 'ROOT', Path(folder)), patch('builtins.print'):
            with patch.object(publisher, 'api', side_effect=interrupted), self.assertRaises(RuntimeError):
                publisher.publish(self.data)
            self.assertEqual(len(github.issues), 14)
            with patch.object(publisher, 'api', side_effect=github.api):
                publisher.publish(self.data)
            self.assertEqual(len(github.issues), 59)
            self.assertEqual(len(github.links), 48)

    def test_private_repo_is_not_made_public(self):
        with patch.object(publisher, 'api', return_value={'private': True}) as api:
            with self.assertRaisesRegex(RuntimeError, 'private'):
                publisher.publish(self.data)
            self.assertEqual(api.call_count, 1)

    def test_network_and_auth_failure_do_not_trigger_creation(self):
        for error in ('error connecting to api.github.com', 'Bad credentials (HTTP 401)', 'Forbidden (HTTP 403)'):
            with self.subTest(error=error), patch.object(publisher, 'api', side_effect=RuntimeError(error)), \
                 patch.object(publisher, 'command') as command:
                with self.assertRaises(RuntimeError):
                    publisher.publish(self.data)
                command.assert_not_called()

    def test_duplicate_remote_keys_stop_import(self):
        issue = {'body': publisher.marker('F01')}
        with self.assertRaisesRegex(RuntimeError, 'Duplicate remote marker'):
            publisher.issue_index([issue, issue])

    def test_conflicting_parent_stops_without_replacing_it(self):
        github = FakeGitHub(copy.deepcopy(self.data))
        github.children[999] = [10012]  # First child will be issue 12, database ID 10012.
        with tempfile.TemporaryDirectory() as folder, patch.object(publisher, 'ROOT', Path(folder)), \
             patch.object(publisher, 'api', side_effect=github.api), patch('builtins.print'):
            with self.assertRaisesRegex(RuntimeError, 'already has a parent'):
                publisher.publish(self.data)
            self.assertEqual(github.children[999], [10012])
            self.assertFalse((Path(folder) / '.pagelet-publish-state.json').exists())

    def test_backlog_rejects_unknown_dependencies_and_cycles(self):
        data = copy.deepcopy(self.data)
        data['epics'][0]['issues'][0]['depends_on'] = ['MISSING']
        with self.assertRaisesRegex(AssertionError, 'Unknown dependency'):
            validate(data)
        data['epics'][0]['issues'][0]['depends_on'] = ['F02']
        with self.assertRaisesRegex(AssertionError, 'cycle'):
            validate(data)


if __name__ == '__main__':
    unittest.main()
