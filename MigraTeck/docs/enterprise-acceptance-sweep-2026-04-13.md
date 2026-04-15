# Enterprise Acceptance Sweep — 2026-04-13

## Scope

This document records the internal control-plane acceptance sweep completed after the production redeploy was healthy.

In-scope pages:

- `/platform/overview`
- `/platform/organizations`
- `/platform/members`
- `/platform/billing`
- `/platform/security`
- `/platform/compliance`
- `/platform/usage`
- `/builder/sites`
- `/platform/hosting`
- `/platform/intake`

Validation basis:

- Real authenticated local runtime, not source-only inspection
- Live CTA execution for member management, security actions, organization switching, and compliance audit loading
- Current code state in the web and auth-api apps after the auth/proxy fixes applied during the sweep

## Critical Fixes Landed During Sweep

1. Control-plane bearer-auth requests were reaching auth-api routes still guarded by cookie-only session middleware.
2. Bodyless `DELETE` requests were being proxied with `Content-Type: application/json`, which caused Fastify to reject them before handlers ran.

Resolved in:

- `apps/auth-api/src/routes/organizations.ts`
- `apps/auth-api/src/routes/sessions.ts`
- `apps/auth-api/src/routes/mfa.ts`
- `apps/auth-api/src/routes/admin.ts`
- `apps/web/src/lib/auth/api.ts`

## Release-Style Acceptance Matrix

| Page | Status | Validated Actions | Remaining Dependencies | Decision |
| --- | --- | --- | --- | --- |
| Overview | Pass | Rendered against real org, billing, session, and audit state; degraded copy verified live after remediation | None for current scope | Enterprise-ready for current product state |
| Organizations | Pass | Organization list rendered; create org succeeded; switch to sandbox org succeeded; switch back succeeded | None for current scope | Enterprise-ready |
| Members | Pass | Members roster rendered; add member succeeded; role update succeeded; remove member succeeded | None for current scope | Enterprise-ready |
| Billing | Pass with scope caveat | Commercial state rendered correctly; unattached billing/payment states now explicit and non-misleading | Richer workflows still depend on real billing ledger/payment attachment | Enterprise-ready as current commercial shell |
| Security | Pass | Password reset request succeeded; MFA enroll succeeded; MFA verify succeeded; MFA disable succeeded; session list succeeded; session revoke succeeded | None for current scope | Enterprise-ready |
| Compliance | Pass with scope caveat | Live audit evidence loaded; policy links available; page copy reflects actual governance scope | Broader incident/retention modules are not exposed yet | Enterprise-ready for current governance scope |
| Usage | Pass with scope caveat | Usage page rendered shared metering state; unattached billing state now explicit | Full value increases when live billable meters are attached | Enterprise-ready as current metering surface |
| Builder | Explicit stub | Commercial entitlements, capacity, and deployment-readiness messaging render correctly | Builder backend not attached; no site inventory/editor/create flow available | Not accepted as enterprise operational surface |
| Hosting | Explicit stub | Commercial capacity and readiness messaging render correctly | Hosting workload backend not attached; no workload inventory or create/deploy console | Not accepted as enterprise operational surface |
| Intake | Explicit stub | Commercial readiness and workflow capacity messaging render correctly | Intake workflow backend not attached; no forms/submissions console | Not accepted as enterprise operational surface |

## Page Notes

### Overview

- Previous weak states such as `Unconfigured`, `Unknown`, and `Unavailable` were replaced with explicit operational language.
- Verified live outputs included `Billing readiness Setup pending` and `Security posture Delegated`.
- Result: the page now communicates known state instead of hiding behind placeholders.

### Organizations

- Commercial boundary text now normalizes unconfigured billing state into readable language.
- The create-and-switch flow was proven through the live control plane using a sandbox organization.
- Result: this page is functionally complete for present organization operations.

### Members

- This page was one of the primary acceptance failures before remediation.
- Root cause was auth-api org/member routes requiring cookie-backed auth while the control plane used bearer auth from the signed app session.
- After the route-guard fix and proxy fix, roster render and member CRUD all succeeded.

### Billing

- The page now uses explicit setup-state messaging such as `Setup pending` and `No ledger`.
- There was no live ledger/payment-method backend state to exercise beyond rendering and interpretation.
- Result: accepted as an honest commercial shell, not as proof of a fully attached billing back office.

### Security

- This page moved from degraded to fully actionable.
- Verified through live control-plane APIs:
  - password reset request
  - MFA enroll
  - MFA verify
  - MFA disable
  - session list
  - session revoke
- Delegated-session copy now avoids contradictory zero-session wording.

### Compliance

- Compliance audit loading was blocked by auth-api admin routes using the wrong auth guard.
- After switching those routes to bearer-capable authenticated-user middleware, live audit evidence loaded successfully.
- Result: accepted for current audit/policy scope.

### Usage

- Usage state no longer reports raw `unknown` billing language.
- Verified live output included `Billing state Not attached`.
- Result: accepted as a metering/status surface for current commercial readiness.

### Builder

- The page explicitly states that builder commercial access is visible before the backend is attached.
- No create-site, editor, versioning, or deployment execution was available to validate.
- Result: correct as an entry shell, not acceptable as a finished enterprise product console.

### Hosting

- The page explicitly states that workload inventory and operational actions depend on a backend not yet attached.
- No workload list, server creation, or deployment controls were available to validate.
- Result: correct as an entry shell, not acceptable as a finished enterprise hosting console.

### Intake

- The page explicitly states that forms and submissions cannot be listed until the intake workflow service is attached.
- No form creation, submission review, or workflow actions were available to validate.
- Result: correct as an entry shell, not acceptable as a finished enterprise intake console.

## Final Sweep Decision

Accepted for enterprise use now:

- Overview
- Organizations
- Members
- Billing
- Security
- Compliance
- Usage

Not accepted yet as enterprise operational surfaces:

- Builder
- Hosting
- Intake

Reason:

- These three pages are now explicit and honest about missing runtime attachments, which is a quality improvement.
- They are still not complete operational consoles and should not be represented as such until their service backends are attached and their primary actions are exercised end-to-end.

## Validation Caveat

This handoff is based on the live acceptance execution already completed during the 2026-04-13 sweep and the resulting code state. It is not a claim that all flows were re-executed again at document-write time.