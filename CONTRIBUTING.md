# Contributing

Pagelet currently contains its delivery plan and a dependency-free UI prototype. Production code starts with the foundation issues.

1. Choose a child issue whose dependencies are complete.
2. Read PRODUCT, ARCHITECTURE, and DESIGN before changing the product.
3. Keep work focused; include the issue number in the pull request.
4. Show the user-visible result, verification performed, and remaining limits.

For API work, test authorization, validation, failure handling, and database constraints. For payment work, test duplicate and out-of-order webhooks. For UI work, check keyboard navigation, 360px mobile width, 200% zoom, reduced motion, and meaningful empty/error states. No frontend-only protection of paid content.

Keep secrets and real customer data out of code, fixtures, screenshots, and logs. The demo must continue to identify itself as a prototype. Dependencies and CI actions should be pinned when the production scaffold is introduced.

An issue is done when its acceptance criteria pass, relevant checks pass, docs match the behavior, and the result is reviewable. Publishing this backlog does not complete any implementation issue.
