# Verification record

Prepared 2026-11-14.

## Completed

- Backlog validation: 11 unique epics, 48 unique stories; every dependency resolves and the dependency graph is acyclic.
- Seven publication tests: complete import plus rerun, interruption recovery, duplicate-marker rejection, parent-conflict rejection, refusal to expose a private repository, no creation on network/auth errors, and rejection of invalid/cyclic dependencies.
- JavaScript syntax check for the interactive prototype.
- Python compilation checks for validation and publication scripts.
- Local HTML checks for unique IDs, valid fragment references, local asset links, and form label targets.
- Git whitespace check.

## Not completed

- Live GitHub publication: `api.github.com` was unavailable from the shell; connector tools could read the account but did not expose repository creation or native sub-issue mutations. The intended repository returned 404.
- Browser visual and interaction checks: the available Playwright package referenced a missing bundled browser. Launching installed Chromium failed because the sandbox denied a required socket operation. No screenshots or browser-test success are claimed.
- Production build, deployment, authentication, payments, database integration and cloud costs: these are future implementation stories. This repository currently contains a design prototype and delivery plan.

## Reproduce local checks

```sh
python3 scripts/validate_backlog.py
python3 -m unittest discover -s scripts -p 'test_*.py' -v
python3 -m py_compile scripts/validate_backlog.py scripts/publish_github.py
node --check design/app.js
git diff --check
```

## Browser review to perform in an unrestricted environment

Open `design/index.html` at 360px, 768px and 1440px. Inspect all three screens and long sample draft names. Check filters/count announcements, product dialog close/Escape/focus restoration, lesson selection/completion, studio navigation, and temporary draft creation. Confirm there is no horizontal page overflow; tables may scroll within their container. Verify 200% zoom, reduced motion and keyboard-only operation. Capture desktop/mobile screenshots before treating the visual direction as reviewed.

The prototype uses only local HTML/CSS/JS and makes no payment or API calls. All draft changes and completion state disappear on reload.
