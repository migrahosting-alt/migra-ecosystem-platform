# Contributing To `apps/web`

This app follows the repo-wide execution standard.

Before building features in `apps/web`, read:

- `/docs/standards/execution-policy.md`
- `/docs/standards/engineering-playbook.md`
- `/apps/web/EXECUTION_STANDARD.md`
- `/agent-templates/vertical-slice-task.md`

## Local Rules

- do not ship backend-only platform work
- do not add hidden routes without a visible entry point
- do not merge placeholder pages into shipped paths
- every feature must be visible and usable in the web app

## Minimum Delivery Standard

For feature work in `apps/web`, include:

- page or panel
- navigation or dashboard entry
- API/data connection
- visible result state
- empty state
- loading state
- error state

## Review Reminder

Before opening a PR, confirm an `OWNER` can:

- find the feature
- open it
- use it
- see the result
