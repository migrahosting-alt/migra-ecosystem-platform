# MigraPilot — Execution Policy UI

© MigraTeck LLC.

## What it is

A per-request execution-policy **preference** selectable from the extension
(status bar → "MigraPilot: Execution Policy", or the command palette). It is NOT
enforcement authority — the **server resolves and enforces** routing, consent,
privacy, and budget. The preference never permits bypassing local-first.

## Server authority

The extension may: display policies, request a permitted active policy, show a
dry-run plan, show the effective policy, and show why a requested policy was
downgraded. It must not: submit routing expressions, define providers/models/
endpoints, alter credentials, raise budget limits, mark providers healthy, or
invoke a cloud provider directly.

## Policies (local-first is always the architecture)

- **Auto** — best eligible provider under capability/privacy/consent/health/budget; local first.
- **Local First** — best local model first; cloud escalation only on a defined fallback condition, if permitted.
- **Local Only** — never sends to cloud; no fallback is offered.
- **Cloud Preferred Fallback** (renamed from "Cloud First") — local still runs first; cloud is the *preferred* fallback once local insufficiency is established. Never a silent bypass.
- **Best Quality** — may escalate sooner after a bounded local assessment; hard privacy/budget still apply; no hidden cloud.
- **Lowest Cost** — lowest expected successful cost; unknown-cost paid providers excluded under hard enforcement.
- **Privacy First** — stays local unless the privacy policy explicitly permits a reviewed, approved transfer.
- **Custom** — bounded server-defined policy; inspection-only until owner-configured fields are exposed.

## Requested vs effective

The response shows both when they differ, never a silent substitution — e.g.
`Requested: Best Quality · Effective: Local Only · Reason: Cloud providers are
disabled`. The effective policy is what the engine applies.

## Accessibility

The selector is a keyboard-navigable QuickPick with descriptions available before
selection; the status bar reflects the active policy; status is conveyed by text,
not color alone.
