# Execution Standard

- no backend-only platform work
- every new route needs a visible page or panel
- every page needs empty, loading, and error state
- every platform feature must be reachable from navigation
- owner visibility test is mandatory

## Required Entry Patterns

Every feature in `apps/web` must be reachable by at least one of:

- sidebar entry
- dashboard card
- settings section
- product landing card

## Done Means Visible

If the feature exists in code but an `OWNER` cannot see and use it in the platform UI, it is not done.
