# Engineering Playbook

## Purpose

This repository is a multi-app MigraTeck monorepo. Product work must be delivered as complete, visible, usable slices across apps and packages.

This playbook exists to keep Builder, Hosting, Billing, Compliance, Security, and future products aligned around one execution model.

## Working Rule

Stop building backend-only systems for visible product behavior.

From this point forward, every feature must be delivered as a complete vertical slice:

- API
- UI page or panel
- navigation entry
- visible data, even if empty or mocked initially
- working interaction
- result that a user can see immediately

## Definition Of Done

A feature is not complete until all of the following are true:

- the route or screen exists
- the feature is reachable from navigation or an intentional entry point
- the primary action works end to end
- the resulting data or state is visible in the UI
- empty state exists
- loading state exists
- error state exists

## Repo Scope

This standard applies repo-wide, including:

- `apps/*`
- `packages/*`
- `app/*`
- `src/*`
- `prisma/*`

It is not limited to one product surface.

## Navigation Requirement

For any new feature under these domains:

- billing
- compliance
- organizations
- security
- builder

the PR must include one of:

- sidebar entry
- dashboard card
- settings section
- product landing card

Hidden routes are not considered complete delivery.

## Owner Visibility Test

Before merge, confirm an `OWNER` can:

1. sign in
2. discover the feature
3. open it from the UI
4. perform the core action
5. see the result without digging through logs or internal tools

If any of those fail, keep building.

## Acceptable Partiality

Some systems legitimately begin with low or empty data. That is acceptable only if the UI still exists and clearly communicates state.

Acceptable:

- empty dashboard with clear CTA
- connected API with visible empty state
- feature card with no records yet and a primary action

Not acceptable:

- finished API with no page
- hidden route with no entry
- placeholder text in shipped UI
- feature merged with "frontend later"

## PR Expectations

Every feature/system PR should show:

- what page or panel was built
- what navigation entry was added
- what user can do now
- what is visible after they do it
- screenshots or recording

## CI Expectations

Repository CI will flag:

- backend/API work without visible UI changes
- obvious placeholder UI in shipped paths

CI is a guardrail, not the whole standard. Reviewers should still apply judgment.

## Agent Execution Format

When assigning work to agents, require:

- route or page target
- main user action
- data/API wiring
- empty/loading/error states
- visibility requirement for an `OWNER`

Use `agent-templates/vertical-slice-task.md` as the default format.

## Apps/Web Local Standard

Contributors working primarily in `apps/web` must also follow:

- `apps/web/CONTRIBUTING.md`
- `apps/web/EXECUTION_STANDARD.md`

Those files restate the repo policy inside the product app where daily work happens.

## Labels And Review Culture

Recommended GitHub labels:

- `vertical-slice`
- `backend-only`
- `ui-missing`
- `needs-surface`

Recommended PR prefixes:

- `feat(platform): ...`
- `feat(builder): ...`
- `feat(billing): ...`

Use infrastructure-only PRs only when they do not change visible product behavior.
