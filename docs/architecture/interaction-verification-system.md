# MigraPilot Interaction Verification System

**Status:** design · **Scope:** design only, no implementation · **Owner:** MigraPilot engineering

Writing a handler is not the deliverable. Proving the control works is.

This document specifies a subsystem that discovers interactive controls, operates them
through the real interface, observes the complete consequence chain, and emits an auditable
report. It exists because the alternative — a passing unit test and a present DOM node —
has repeatedly failed to catch defects that only appear when a control is actually used.

## 1. Why, from this codebase

Three defects motivate the design. All three passed every test that existed at the time.

| defect | what was green | what was broken |
|---|---|---|
| Capability frame never rendered | Brain emitted the SSE frame; route tests asserted it; extension unit tests passed | Nothing in the extension handled the event. The governance disclosure reached no one. |
| Evidence selector defined but not rendered | The model existed and was exported | Tree-shaken out of the bundle; the control was absent from the shipped UI |
| `Diagnose Failure` hung on a toast | Unit tests passed; the API path worked | The command `await`ed an informational notification whose result was discarded, so the command never completed until the toast was dismissed |

Each was found by operating the surface, and only by operating the surface. The third
surfaced solely in the packaged-artifact run — a 60-second timeout in a region no HTTP probe
enters, between the palette and the handler's first `await`.

The lesson generalises: **the gap between "the code is correct" and "the control works" is
where these defects live.** This subsystem is instrumentation for that gap.

## 2. Proof levels

Every verification claim carries a level. Nothing may claim a level it did not reach.

```
Level 1  handler / unit proof              the function behaves
Level 2  command or accessibility invocation  the registered action runs
Level 3  real application-host execution    a real host launched it        (@vscode/test-electron)
Level 4  installed artifact execution       the packaged build ran it      (VSIX, signed bundle)
Level 5  live user-environment spot-check   the operator's own session
```

"Tests pass" is Level 1. Reporting it as though it were Level 3 is the specific dishonesty
this scale prevents. A surface may be release-accepted at Level 4 with Level 5 outstanding,
provided the outstanding item is **named**, not folded into a pass.

The evidence report states the level per control. A report containing controls at mixed
levels shows each one's level; it never averages them.

---

## 3. Control identity

This section comes first because everything else depends on it. You cannot replay a trace,
detect an inert control, or correlate an audit event to a control without an identity that
survives a re-layout, a rename, or a translation.

### 3.1 Three distinct concepts

Conflating these is the most common failure in UI test tooling, and it is why such suites
rot.

**Control identity** — *what logical action this is*, across releases, layouts and locales.
Durable. Declared, never inferred.

**Control locator** — *how a specific adapter finds it in the current host*. Mutable,
host-specific, and expected to change. Several locators may resolve one identity.

**Control instance** — *the concrete rendered occurrence* acted on during one trace. Exists
only for the duration of that trace. Two instances of the same identity may be live
simultaneously (the same action in a toolbar and a context menu).

### 3.2 The identity model

```
applicationId    which application owns the surface
surfaceId        the logical region within it
controlId        the logical action
controlVersion   the contract generation of that action
instanceScope    what the action's effect is scoped to
```

```yaml
applicationId: migrapilot-vscode
surfaceId: engineer.chat.toolbar
controlId: diagnose-failure
controlVersion: 1
instanceScope: workspace
```

**`controlVersion` tracks meaning, not appearance.** Bump it when what the control *does*
changes in a way that invalidates a recorded expectation — a new confirmation step, a
changed authority requirement, a different destination. Do **not** bump it for a label
change, an icon change, or a move between menus. A version that churns on cosmetics is a
version nobody trusts, and stale traces would be discarded for the wrong reason.

**`instanceScope`** is one of `global`, `window`, `workspace`, `session`, `document`. It
tells the runner what must be isolated between traces and what a cleanup step has to
restore. A `workspace`-scoped control that mutates state requires workspace isolation; a
`document`-scoped one does not.

### 3.3 What identity must never depend on

- visible label text
- DOM position or sibling order
- CSS class or styling hook
- screen coordinates
- icon or glyph
- localization
- layout order or responsive breakpoint

Every one of these is a **discovery attribute**: useful for *finding* a control, invalid for
*being* one. A suite keyed on any of them fails on the first redesign and — worse — can
silently act on the wrong control after a reorder.

The identity is a **contract**. It is declared in source alongside the control, reviewed
like any other contract, and changing it is a deliberate act.

### 3.4 Declaration, not inference

Identities are registered where the control is defined:

```
registerControl({
  surfaceId: 'engineer.command-palette',
  controlId: 'diagnose-failure',
  controlVersion: 1,
  instanceScope: 'workspace',
  locators: [{ adapter: 'vscode-command', commandId: 'migrapilot.diagnoseFailure' }],
  destructive: false,
})
```

Inferring identity from the rendered tree is rejected. Inference produces identities that
change when the UI changes, which is precisely the property identity must not have. A
control absent from the registry is **undiscovered**, and the report says so — an honest
gap beats a fabricated identity.

---

## 4. Locators and adapters

A locator answers: *given this identity, how does this adapter reach the control here?*

### 4.1 Confidence tiers

```
exact        a registered, host-guaranteed handle
             vscode command id · test id attribute · accessibility id · stable data-* hook

semantic     an accessibility-tree match on role + accessible name
             correct in principle, sensitive to localization and to duplicate names

heuristic    visible-text or structural matching
             brittle; acceptable only for read-only exploration

positional   coordinates or index
             a last resort that proves almost nothing about identity
```

**Silent fallback between tiers is prohibited.** If an `exact` locator fails, the runner
does not quietly try `semantic`. It records the failure, and only attempts a lower tier when
the trace explicitly permits it. Every downgrade appears in the evidence report with its
tier and reason.

**Destructive actions accept `exact` only.** A control that deletes, deploys, approves, or
mutates production is never reached by fuzzy match. If the exact locator is gone, that is a
finding, not an obstacle to route around.

### 4.2 Adapters

| adapter | reaches | typical exact locator | max level |
|---|---|---|---|
| `vscode-command` | VS Code command registry | `commandId` | 3–4 |
| `vscode-webview` | webview DOM inside the host | `data-control-id` | 3–4 |
| `web-dom` | browser page (Playwright) | `data-control-id`, ARIA id | 3–4 |
| `electron-main` | Electron window via CDP/driver | accessibility id | 4 |
| `desktop-host` | OS-level input | accessibility id (AT-SPI/UIA/AX) | 5 |
| `cli` | command-line entry points | argv contract | 3–4 |

Adapters are **capability-declaring**: each states which levels it can reach and which
evidence kinds it can capture. The runner never claims a level its adapter cannot produce.

**Recorded limitation.** In this repository VS Code runs as Remote-WSL — the server is in
WSL, the Electron window is a Windows process. `desktop-host` is therefore unavailable for
the live window from the WSL side, and Level 5 needs either a Windows-side agent or a
human. This is a real constraint of the environment, recorded so it is not rediscovered.

---

## 5. Discovery

Discovery enumerates what *could* be operated and reconciles it against the registry.

Sources: the control registry (authoritative), the accessibility tree, host command
registries (`vscode.commands.getCommands`), declared contribution points (`package.json`),
and rendered DOM in webviews.

Discovery produces three sets, and all three are reported:

- **Registered and found** — verifiable.
- **Registered but not found** — a control that should exist and does not. This is the
  tree-shaken-selector defect, detected automatically.
- **Found but not registered** — a reachable control nobody declared. Not necessarily a
  defect, but an unverified surface, and it must not be silently ignored.

The third set is the one most tools drop. Dropping it makes coverage look complete when it
is merely narrow.

---

## 6. What an interaction verifies

Invoking a control is the beginning. The chain is:

```
control present  →  invocation accepted  →  handler executed  →  state transition
                 →  backend / tool action  →  result rendered  →  audit recorded
                 →  failure and recovery behave
```

For each link the trace declares an **expectation** and the runner captures **evidence**.

### 6.1 State transitions

Expectations are declared, not inferred: which surface appears, which value changes, which
region becomes enabled or disabled. A transition is asserted against the accessibility tree
and host state, not against a screenshot — pixels are evidence for humans, not assertions.

### 6.2 Backend and audit correlation

The runner injects a correlation id where the host allows it, and afterwards queries the
audit for that id. The expectation names event types and required fields
(`capability.decided`, `workflow`, `authority`).

An interaction that renders correctly and records **no** audit event is a finding: this
platform's governance claims rest on those records, so a missing one is a broken guarantee
even when the UI looks right.

### 6.3 Inert-control detection

A control is **inert** when invocation is accepted and nothing happens: no state transition,
no backend call, no audit event, no error. This is the "button that does nothing" case, and
it is invisible to unit tests because the handler exists and returns.

Detection: invoke, wait the settle budget, compare the observed effect set against the
expected one. Empty observed set plus accepted invocation equals inert. Report it as a
defect, distinguishing it from a control that failed loudly — a failure is at least honest.

### 6.4 Timeout and hang detection

Three distinct outcomes, never collapsed:

```
settled     the invocation promise resolved within budget
slow        settled, but over the expected budget            → performance finding
hung        never settled within the hard ceiling            → defect
```

The `Diagnose Failure` toast defect was a **hang**: the promise never settled because it
awaited a dismissal that never came. Any system reporting only pass/fail would have shown a
timeout and left the cause to a human. The runner captures what the invocation was waiting
on — pending host dialogs, open notifications, in-flight requests — because that is the
difference between a diagnosis and a stack trace.

**Every trace declares a settle budget and a hard ceiling.** No unbounded waits.

### 6.5 Failure and recovery paths

Happy-path-only verification is incomplete verification. Where applicable a trace covers:
invalid preconditions (the control refuses cleanly and produces no side effect),
cancellation mid-flight (partial work is abandoned, nothing half-applied), backend
unavailability (a clear error, no fabricated success), and retry (a second attempt succeeds
without duplicating the first).

---

## 7. Destructive-action safeguards

Verification must not become the thing that breaks production.

- Destructive controls are **declared** `destructive: true` at registration and default to
  destructive when unknown.
- They run only in an **isolated environment** — throwaway workspace, disposable branch,
  non-production endpoint — asserted by the runner before invocation, never assumed.
- They require an **exact** locator.
- A destructive trace is **refused** if the environment cannot be proven isolated. Refusing
  to verify is the correct outcome; verifying against production is not.
- **Approval-gated** actions are verified up to the approval prompt, and the approval itself
  is exercised only in isolation. Capability authority and operator approval remain separate
  questions and both must hold.

---

## 8. Isolation and cleanup

Each trace declares its `instanceScope` and the runner isolates accordingly: a fresh
workspace, a fresh window, a fresh session.

Cleanup is **verified, not attempted**. After each trace the runner asserts the environment
returned to its recorded baseline — no leftover files, no modified settings, no orphaned
processes, no open documents that would confuse the next trace.

That last one is not hypothetical. The first version of the command-path test found the
*previous* test's untitled document and asserted against the wrong output. Traces must be
isolated from each other's residue, and the runner proves it rather than hoping.

---

## 9. Traces and replay

A trace is a declarative, versioned, replayable description of one verification.

```yaml
trace: diagnose-failure.happy-path
level: 3
control:
  applicationId: migrapilot-vscode
  surfaceId: engineer.command-palette
  controlId: diagnose-failure
  controlVersion: 1
locator:
  adapter: vscode-command
  commandId: migrapilot.diagnoseFailure
  confidence: exact
preconditions:
  - workspace: isolated
  - document: open, with at least one error diagnostic
budget: { settleMs: 15000, ceilingMs: 60000 }
expect:
  state:  { newDocument: { untitled: true, languageId: markdown } }
  render: { framesInOrder: ['Source mode:', 'Live knowledge:', 'Capability:'] }
  audit:  { events: ['capability.decided'], fields: { workflow: diagnose.failure } }
  mutation: { repositoryFiles: none }
cleanup:
  - close: newDocument
  - restore: workspace-baseline
```

Replay re-runs the trace against a new build. A trace whose `controlVersion` no longer
matches the registry is **not silently replayed** — the contract changed, and the trace is
reported as stale so a human decides whether the expectation or the control is wrong.

---

## 10. Evidence report

The report is the deliverable. It must be inspectable by someone who did not run it.

Per control: identity, level reached, locator and confidence tier (with any downgrade and
its reason), outcome (`verified` / `inert` / `hung` / `failed` / `undiscovered` / `refused`),
evidence artifacts, correlated audit event ids, and cleanup verification.

Per run: the three discovery sets, controls verified per level, and — stated explicitly —
**what was not verified and why**. A report that omits its own gaps is the failure mode this
system exists to prevent, so the gap list is mandatory and empty only when genuinely empty.

Evidence artifacts: accessibility-tree snapshots (assertable), screenshots (human review),
host and extension logs, request/response metadata, and audit records. Screenshots are
never the basis of an automated assertion — they are how a human confirms the machine
checked the right thing.

**Reports carry no secrets.** The existing audit rules apply unchanged: metadata only, no
prompts, no bodies, no credentials, no query strings, flat primitives.

---

## 11. Non-goals

- Not a general end-to-end test framework; it verifies **controls and their consequences**.
- Not a visual-regression system; screenshots are evidence, not assertions.
- Not a load or performance harness, beyond distinguishing slow from hung.
- Not a replacement for unit tests. Level 1 stays cheap and fast and catches different
  defects.
- Not a way to reach Level 5 automatically in every environment. Where the host cannot be
  driven, the correct output is a named gap.

## 12. Open questions

1. **Registry placement.** Co-located with each control (accurate, scattered) or centralised
   (reviewable, drifts)? Leaning co-located with a build-time aggregation step.
2. **Webview identity.** Webview DOM needs a `data-control-id` convention that survives the
   bundler — the tree-shaking defect suggests asserting the attribute's presence in the
   built artifact.
3. **Audit correlation for non-Brain actions.** Not every control produces a Brain audit
   event. What is the expectation for controls whose only effect is local editor state?
4. **Level 5 in Remote-WSL.** Needs a Windows-side agent or a human. Worth building, or
   worth accepting as a permanent human step?
5. **Trace authorship.** Hand-written, or recorded from a human session and then edited? A
   recorder is powerful and risks capturing locators rather than identities.

## 13. Delivery order

Design only in this slice. Implementation, when authorized:

1. Control registry + identity model, with the VS Code command adapter (highest value,
   lowest risk — the command path is already proven).
2. Trace runner with settle/ceiling budgets and hang classification.
3. Audit correlation and inert detection.
4. Discovery and the three-set reconciliation.
5. Webview and web-DOM adapters.
6. Evidence report and replay.
7. Destructive-action isolation, last and behind explicit authorization.

Each step ships with its own verification at the level it claims.
