# GitHub publication

Target: **public `kasuken/Pagelet`**. Description: **Your website. Your products. Your start.**

The prepared repository includes README, MIT license, contributor guidance, issue/PR templates, product/architecture/design/cost/research documents, an interactive prototype, and a backlog of 11 epics plus 48 stories in four milestones. The publisher applies repository description, homepage and discovery topics, labels, milestones, dependency links and **native GitHub sub-issue relationships**.

## Current status

Local files are prepared. At preparation time, terminal network access to `api.github.com` was unavailable, the connected GitHub tools did not expose repository creation or native sub-issue management, and there was no connected browser. The connected account was `kasuken`; `kasuken/Pagelet` returned 404. Therefore no remote creation or issue publication is claimed by these files.

## Publish from a network-enabled terminal

Use an existing authenticated GitHub CLI session for `kasuken` with repository creation and repository/issue administration access. Never paste a token into an issue or chat.

```sh
cd /home/ema/github/Pagelet
gh auth status
python3 scripts/validate_backlog.py
python3 scripts/publish_github.py
python3 scripts/publish_github.py --apply --push
```

The first publisher invocation is a dry run. The last command creates the public repository if absent, configures metadata, pushes the clean `main` branch without force, creates labels and milestones, then creates all epics/stories and attaches each story to its epic using GitHub's sub-issues API. It verifies each parent relation before reporting success. It refuses to expose an existing private repository.

If the local files are not yet committed, commit them first. If a remote was initialized independently with commits, reconcile its history normally before pushing; the publisher will never force-push. To publish only the backlog into an existing repository without editing repository settings or pushing files, use `--apply --issues-only`.

The publisher is resumable: it reads all pages of open and closed issues, reuses stable `pagelet:key` markers, preserves human notes outside generated blocks and never reopens completed issues. A failure stops immediately. Rerun after fixing it; a conflicting existing parent is not silently replaced. The local `.pagelet-publish-state.json` is a verification receipt, ignored by Git.

## Manual recovery

If creation is done through GitHub's UI, choose an empty public repository called Pagelet under kasuken. Avoid initializing a separate README when pushing this local history. Then run the publisher. The marker-based import works even if individual issues were already created from this manifest.

Native child links use the numeric database issue ID in `POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues`, not the visible issue number. See [GitHub's sub-issues API](https://docs.github.com/en/rest/issues/sub-issues). Parent checklist references provide navigation but do not substitute for those native relations.

No billing resources, live payment setup, or customer data are required to publish this planning repository.
