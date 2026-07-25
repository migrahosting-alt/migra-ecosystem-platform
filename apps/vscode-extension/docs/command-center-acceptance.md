# MigraPilot Command Center — Visual & Functional Acceptance

**Acceptance date:** 2026-07-25 · **Owner-ratified** · Branch `phase-1/canonical-vscode-extension`

Records the owner acceptance of the Command Center redesign and the canonical
sidebar-launcher correction. Companion to
[`canonical-extension-status.md`](./canonical-extension-status.md) (which extension
is canonical) — this document records which **interface** is canonical.

## Owner acceptance

```text
Command Center: visually accepted
Canonical sidebar launcher: visually accepted
Classic chat visible by default: no
Classic Agent Mode visible by default: no
Duplicate composer: no
Developer restoration path: validated
Installed VSIX: validated
Working tree: uncommitted
```

## Canonical interface designation

**The MigraPilot Command Center is the canonical user-facing interface.**

| Field | Value |
|---|---|
| Canonical surface | Command Center editor panel (`migrapilot.studio`) |
| Entry command | `migrapilot.openStudio` — *MigraPilot: Open Command Center* |
| Also opened by | `migrapilot.openChat`, `migrapilot.openAgentMode` (Agent Workspace tab), `migrapilot.openWorkspacePanel` (Workspace tab) |
| Sidebar surface | `migrapilot.sidebar` — a compact **navigation/status launcher**, not a second application surface |
| Tabs | MigraPilot Chat · Agent Workspace · Run Diff · Audit Trail · Workspace |
| Regions | left navigation (sidebar) · main · right context panel; degrades to drawers at medium/narrow widths |

There is exactly **one** chat composer, **one** Agent Mode approval path,
**one** run-history surface and **one** workspace lifecycle surface in the product.

### Sidebar launcher — approved visible action set

Order is part of the accepted contract, pinned by
`src/test/unit/shellWebview.test.ts`.

| # | Action | Dispatch |
|---|---|---|
| 1 | **Open Command Center** (primary) | reveals the Command Center · Chat |
| 2 | New Task | reveals the Command Center · Agent Workspace |
| 3 | Pending Approvals *(count)* | reveals the Command Center · Agent Workspace |
| 4 | Active Runs *(count)* | reveals the Command Center · Agent Workspace |
| 5 | Run History *(count)* | reveals the Command Center · Audit Trail |
| 6 | Brain Status | `migrapilot.health` |
| 7 | Repair Connection | `migrapilot.repairConnection` |
| 8 | Logs | `migrapilot.showLogs` |
| 9 | Settings | opens MigraPilot settings |

Plus read-only status sections: Workspace (name · branch · dirty-state count) and
Tools & Services (Brain Service · Local Models · Git Integration · Policy Engine ·
Audit Store).

Counts come from canonical durable/runtime state and render **blank when
unreadable** — never `0`, because "no pending approvals" and "pending approvals
unknown" are different facts.

## Superseded surfaces — retained, not deleted

| View id | Name | Default visible | Gate |
|---|---|---|---|
| `migrapilot.sidebar` | MigraPilot | ✅ | — |
| `migrapilot.chatView` | Chat (Classic — Developer Only) | ❌ | `config.migrapilot.enableClassicViews` |
| `migrapilot.agentMode` | Agent Mode (Classic — Developer Only) | ❌ | `config.migrapilot.enableClassicViews` |
| `migrapilot.workspace` | MigraAI Workspace (Classic — Developer Only) | ❌ | `config.migrapilot.enableClassicViews` |

The compact launcher is the **only** default-visible view.

Restoration is possible **only** through the explicit developer setting
`migrapilot.enableClassicViews` (boolean, default `false`). The two developer
commands `migrapilot.dev.openClassicChat`, `migrapilot.dev.openClassicAgentMode`
and `migrapilot.dev.openClassicWorkspace` are hidden from the Command Palette
unless that setting is on
(`menus.commandPalette` `when` clauses) and refuse — non-blocking — while it is
off. Because the view *contributions* are gated by the same context key, a
non-contributed view cannot be focused: the setting is the single real gate.

Enabling the gate widens **no** permission: the classic views use the same
server-owned proposal + one-time approval boundary and the same evidence-only
history.

Legacy implementations are retained pending proof that all canonical workflows
have migrated. No legacy code was deleted.

## Validation

| Gate | Result |
|---|---|
| Root typecheck · build | clean |
| Root test (brain-service + extension) | 662 pass |
| Extension unit | 448 pass |
| Ops validation | 11 pass |
| Integration — real VS Code, dev host | 63 pass |
| **Installed acceptance — real VS Code, packaged VSIX** | **63 pass** |
| VSIX package · inspect | 93 files · 26 commands · `ok: true` |
| Real `--install-extension` | installed; on-disk manifest re-read and confirmed |

`npm run inspect:vsix` now enforces the canonical-interface contract on the
packaged manifest and reports:

```json
{
  "canonicalInterface": "migrapilot.openStudio",
  "defaultVisibleViews": ["migrapilot.sidebar"],
  "classicViewsGatedBy": "config.migrapilot.enableClassicViews",
  "classicViewsDefaultEnabled": false,
  "duplicateChatSurfaces": 0,
  "hiddenAgentApprovalCommands": 0
}
```

The guard was proven by a negative test: a VSIX tampered to un-gate
`migrapilot.chatView` is rejected with
`Packaged manifest exposes superseded classic views by default`.

### Decisive assertions

- **The old chat UI cannot appear.** `MigraPilotApi.classicViews` exposes
  `chatResolved()` / `agentModeResolved()`. The installed-acceptance test walks the
  full default journey — activity-bar container → launcher → Command Center →
  `openChat` → `openAgentMode` — then asserts both are `false`. VS Code never
  asked the superseded views to render.
- **The restore path works.** The test turns `enableClassicViews` on, runs the
  developer command, asserts the classic view *does* resolve, then resets. The
  retained code is genuinely reachable, so retention is real rather than nominal.
- **No command regression.** All 23 pre-redesign command ids are pinned by
  `src/test/unit/contributions.test.ts`.

### Security boundaries re-confirmed

- No approval material in any webview: the preview fingerprint never leaves the
  extension host; the webview posts a bare `approve` / `reject` intent and the host
  binds the decision to the fingerprint it holds from authoritative server state.
- No activation capability, bootstrap secret, proposal fingerprint, snapshot
  manifest digest, workspace-material fingerprint, environment value or absolute
  path is displayed.
- History is evidence-only: `historyControlAvailability()` is constant all-false
  and `resume` is typed `false`. The context-panel renderer is a separate script
  fragment from the launcher bundle, so the sidebar structurally cannot contain a
  history execution path.
- Brain lifecycle unchanged: the shell reads `/health` only; it never starts,
  stops or restarts the service.
- Webview command dispatch is limited to an allow-list of already-registered
  `migrapilot.*` commands.

## Verification method — scope note

Behavioural verification ran **inside real VS Code** against the packaged VSIX
(61 installed-acceptance tests, plus a genuine `--install-extension` whose on-disk
manifest was re-read).

The accepted **screenshots** were rendered from a harness that loads the shipped
`dist` HTML/CSS/JS with a stubbed `acquireVsCodeApi` and a schema-correct
`ShellState`. This WSL2 environment segfaults a standalone VS Code Electron launch
under Xvfb and has no `xdotool` to drive the activity-bar icon, so the window
itself was not photographed. Layout, palette, ARIA roles, keyboard behaviour,
horizontal-overflow and sanitation sweeps were verified against the real shipped
assets across 64 page/width combinations.

## MigraAI Workspace consolidation (2026-07-25)

The standalone `migrapilot.workspace` panel was migrated into the Command Center's
**Workspace** tab and then retired to the same developer gate.

Migrated in full — six sections (Workspace · Semantic Index · Memory · Agents ·
Models · Engine) and eight actions (Open · Sync · Rebuild · **Approve Index** ·
Change Memory Mode · Diagnostics · Refresh · **Delete**). The tab re-dresses the
ratified `workspaceViewModel` mapper rather than re-implementing it, and the
lifecycle choreography lives in a shared `workspaceActions.ts`, so both surfaces
ran identical flows while they coexisted.

Two boundaries preserved verbatim:

- **Index-version binding** — approval binds to the version observed at click
  time, read from host-held state; the webview never sees it. A stale version is
  refused by the engine (`INVALID_STATE`) and surfaced as "review the new
  version". Verified live in the installed-acceptance gate.
- **Scoped delete** — still confirmed through `deleteScopeFor()`, which states
  what is removed AND what is kept.

Index promotion renders as its own governed card, distinct from Agent Mode's
command approval: they are different approval boundaries.

### Branch semantics

The engine's `gitBranch` is the branch recorded at LAST SYNC — a property of the
index, not of the checkout. Labelling it plain "Branch" beside the live branch in
Workspace Context made the product look inconsistent when they legitimately
differ. The tab now shows both facts, neither overwriting the other:

| Row | Source |
|---|---|
| Indexed branch | engine `WorkspaceView.workspace.gitBranch` (branch at last sync) |
| Current branch | live read-only Git inspection |
| Index freshness | shown only when they diverge — "sync to reindex the current one" |

### Defects found and fixed during this slice

1. **`workspaceController` was `undefined` at shell construction** — `extension.ts`
   built the shell before assigning it, so every workspace read threw and was
   reported as "engine unreachable". The Workspace tab could never have worked in
   the installed extension. Fixed with a lazy accessor; pinned by a unit test.
2. **`workspaceError` latched** — the tab checked the error before the loaded
   model and no success path cleared it, so one transient failure pinned the tab
   to "unreachable" while the engine was healthy.
3. **Tab reveal did not load** — `showTab` now drives the per-tab read on every
   path, not only on a strip click.
4. **The renderer was never called** — the state handler omitted
   `renderWorkspaceTab`, so the tab painted empty. A guard test now asserts every
   region has both a renderer and a call.

## Test process ownership (2026-07-25)

`killStaleBrains` swept every brain-service on its port list — which includes
**3988, the developer's default `migrapilot.brainUrl`** — and so destroyed brains
the suite never launched.

Identity is no longer sufficient: a process must be provably **test-owned** before
it can be killed.

- Every brain a run starts carries `MIGRAPILOT_TEST_BRAIN_OWNER`, stamped into
  `process.env` before the first sweep and forwarded via `extensionTestsEnv`, so
  brains spawned by the *extension under test* (which inherits the environment)
  are attributable too.
- Ownership is proved from `/proc/<pid>/environ`, captured at exec, so it survives
  reparenting — unlike a PID file, which can go stale and be reused.
- **Fail closed**: unreadable or unprovable ownership leaves the process running.
- The sweep reports what it `killed` and what it `spared`, and logs each sparing,
  because silently sparing looks identical to silently killing.
- The lifecycle host test moved to its own port (**3992**). It previously asserted
  "brain not running before auto-start" on 3988 and only passed because the
  harness had destroyed whatever was there — a test asserting that shutdown stops
  *only the owned process* was buying its precondition by killing an unowned one.

Regression coverage spawns **real processes**: a decoy brain without the marker
and one with it. The unmarked brain must survive the sweep; the marked one must be
swept. Confirmed end-to-end against a live developer brain (pid 1053101), which
survived every suite run with `[staleBrains] spared pid 1053101 on :3988`.

## Deferred
- Seven commands that had a pre-redesign sidebar row and are not in the approved
  nine (`explainSelection`, `fixDiagnostics`, `generateTests`, `generateCommit`,
  `reviewApprovals`, `showDiagnostics`, `showBackendDiagnostics`) remain reachable
  via the Command Palette, Command Center slash commands and welcome cards; they
  no longer have a sidebar row.
- Retirement of the classic view implementations, once migration of all canonical
  workflows is proven.
