# Execution Policy

## Core Rule

MigraTeck ships features as vertical slices.

Do not ship backend-only product work.
Do not create hidden routes without navigation.
Do not leave placeholder surfaces in the platform UI.

Every feature that changes product behavior must include:

- schema or data work when needed
- application logic
- API wiring when needed
- a visible page, panel, or route surface
- navigation entry or discoverable entry point
- usable interaction
- visible result state
- empty, loading, and error states

## Owner Visibility Test

For work in platform or product apps, an `OWNER` must be able to:

- find the feature
- open the feature from navigation or a dashboard entry
- perform the primary action
- see the result immediately

If the feature cannot pass that test, it is not done.

## Forbidden

- backend-only work for visible product behavior
- hidden routes with no entry point
- "UI later" implementations
- placeholder screens in shipped paths
- unfinished features merged behind vague follow-up promises

## Required Entry Points

Features in these areas must include at least one visible entry point:

- dashboard card
- sidebar entry
- settings section
- product landing card

This applies especially to:

- dashboard
- organizations
- members
- billing
- security
- compliance
- builder

## Pull Request Standard

Every PR that changes product behavior must:

- complete the vertical-slice checklist in the PR template
- include screenshots or recording
- describe how an `OWNER` can use the feature

## CI Enforcement

The repository blocks pull requests that introduce backend/API changes without any corresponding visible UI surface.
