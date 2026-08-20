# Surface audit — what the product shows, and what it does not

Every registered user-facing surface in the installed extension, classified. **107 surfaces**:
30 commands, 4 views, 5 tabs, 13 sidebar rows, 7 sidebar sections, 4 shell navigation
sections, 6 context panels, 5 header actions, 6 composer controls, 2 editor context-menu
entries, 1 Activity Bar container, 3 notification actions, 4 status surfaces, 17 settings.

The classification is not this document. It is
[`src/panel/shell/surfaceClassification.ts`](../src/panel/shell/surfaceClassification.ts),
and the interface is BUILT from it: `shellHtml` emits a region only when the current mode
allows it, the command palette's `when` clauses mirror it, and tests fail if the manifest and
the classification disagree or if a new surface is left unclassified. A document could drift;
this cannot. What follows is generated from that file.

## The lock

| | |
|---|---|
| **PRODUCT UI** | What the user needs to accomplish work. |
| **CONTROL PLANE** | Users, permissions, plans, usage, policies, system health, service configuration, administrative controls. Belongs in the central Migra control panel. |
| **ENGINEERING** | Internal diagnostics, model operations, deployment, index internals, low-level runtime troubleshooting. Operated through code and config while the system is internal. |

The normal interface exposes `core-product` and `supporting-product-state` **only**. Everything
else is reachable by turning on `migrapilot.developerMode`, which is off on a normal install.

**Nothing was deleted.** Every backend behind every hidden surface is untouched: the semantic
index, model routing, the approval boundary, the audit store, Agent Mode, the retention worker
and the policy engine all still run. What changed is who has to look at them.

## What the pivot changed

| Before | After |
|---|---|
| 5 tabs: Chat · Agent Workspace · Run Diff · Audit Trail · Workspace | **2**: Ask · Changes |
| 4 nav sections incl. Tools & Services (Brain Service, Local Models, Policy Engine, Audit Store) | **2**: Conversations · Current workspace |
| 6 context panels incl. Brain Service Status (endpoint, version, schema version, retention worker) | **4**: Workspace · Active Run · Context Files · Recent Activity |
| 6 cards: Build or Fix Code · Inspect & Analyze · Run Agent Task · **Diagnose System** · Review Changes · **Run History** | **6 outcomes**: Explain code · Fix code · Plan a task · Review changes · Run tests · Debug a failure |
| 3 composer selectors incl. model routing and evidence source | **1**: live knowledge — a real user decision |
| 20 slash commands incl. `/agent`, `/policy`, `/health`, `/noevidence` | **12**, all outcomes; `/edit`, `/tests`, `/debug`, `/run`, `/changes` added |
| 30 commands in the palette | **14**: 13 product + one developer door |
| 17 settings shown together | product settings first; the rest classified as engineering |
| **Sidebar**: Open Command Center · Agent Mode · Workspace · Tools & Services · Service | **New Task · Recent · Workspace · Quick Actions** |
| Status line: `Brain: Healthy · Schema: v0 · Policy: auto · Agent Mode: Off` | **`Branch · MigraPilot: Ready`** |
| VS Code status bar: `MigraPilot: local` · `auto` · `Agent Mode: OFF` | **one item**: `MigraPilot: ready` |

**Most of these were found by looking at the running product, not by reading the code.** The
first pass classified 77 surfaces from source and missed both status surfaces. The second pass
missed something larger: **the entire sidebar**. `migrapilot.sidebar` — the view the Activity
Bar icon opens, the first thing anyone sees — is rendered by `navigationHtml.ts`, not
`shellHtml.ts`, and shipped the console intact through a "complete" pivot with 834 tests green.
A pre-existing test even asserted that console AS THE APPROVED CONTRACT, naming Brain Status,
Repair Connection and Logs. It was green *because* the console was still there.

Two rules came out of that, and both are now enforced in code: **every registered user-facing
surface must be classified** (a test enumerates the manifest and fails on any gap), and
**hiding markup is not a boundary** — `navActionAllowed` and `dispatchCommand` refuse an
engineering surface in product mode even if a webview message asks for it.

The sidebar is deliberately compact. Fewer visible controls, not less capability: Git blame,
the repository index, the command runner, the changeset engine, model routing and the test
parser are all still there — the assistant reaches for them, the user picks the outcome.

Two things are deliberately kept in the product because they are **real decisions a person has
to make**: the live-knowledge control (does anything leave this machine) and the approval
review. Governance is not the same as machinery.

One thing is withdrawn carefully rather than hidden: the **evidence-source selector** and the
`/approved` shortcut are removed *together*, so the mode cannot be selectable-but-invisible —
the exact defect the original test was written to prevent. The host-rendered provenance line
is untouched: whichever source answered is still stated with the answer.

### core-product — 32

| Kind | Surface | Why |
|---|---|---|
| Command | Open MigraPilot `openStudio` | The product surface itself. |
| Command | Ask MigraPilot `openChat` | Where you ask. The entry point of the journey. |
| Command | Fix Code `quickEdit` | Ask for a change, see the diff, apply it. |
| Command | Make a Code Change `governedCoding` | The larger propose → review → apply path for real work. |
| Command | Explain Code `explainSelection` | Understand the repository — a named outcome. |
| Command | Fix Problems in This File `fixDiagnostics` | Acts on the errors the editor already shows. |
| Command | Review Changes `gitOverview` | What changed, on what branch, by whom. |
| Command | Run Tests `runTests` | Verification — the step that decides whether work is done. |
| Command | Run a Command `runCommand` | Running the project’s own tooling is ordinary coding work. |
| Command | Debug a Failure `diagnoseFailure` | Explains why something failed. A user outcome, despite the name. |
| Command | Write Tests `generateTests` | Produces code the user keeps. |
| Command | Write a Commit Message `generateCommit` | Produces text the user keeps. |
| Command | Review Pending Actions `reviewApprovals` | Approval IS a decision the user must make — it stays in the product. |
| View | MigraPilot `migrapilot.sidebar` | The one view a normal install shows. |
| Tab | Ask `chat` | Ask, and read the result. |
| Tab | Changes `diff` | “Show me the diff” is step five of the journey. |
| Header | New Task `newTask` | Start fresh work. |
| Composer | Attach context `ccontext` | Choosing what MigraPilot looks at is part of asking. |
| Composer | Attach file `cattach` | Attaching a file is part of asking a question well. |
| Composer | Dictate `cmic` | Speaking the question is another way of asking it. |
| Sidebar row | New Task `newTask` | Starting work is what a person opened the sidebar to do. |
| Sidebar row | Explain Code `explainCode` | Understand the repository — step two of the journey. |
| Sidebar row | Fix Code `fixCode` | Describe a change, see the diff, apply it. |
| Sidebar row | Review Changes `reviewChanges` | See what changed before trusting it. |
| Sidebar row | Run Tests `runTests` | Verification decides whether the work is done. |
| Sidebar row | Needs your approval `pendingApprovals` | A real decision only the user can make — and shown ONLY when one is waiting. |
| Sidebar section | Quick Actions `nav-quick` | Four outcomes, one click each. |
| Sidebar section | Approval prompt `nav-approvals` | Appears only when a decision is actually pending. |
| Context menu | Explain Code (right-click) `migrapilot.explainSelection` | IDE-native entry to a product outcome, on a real selection. |
| Context menu | Fix Problems (right-click) `migrapilot.fixDiagnostics` | Acts on the errors the editor already shows. |
| Activity Bar | MigraPilot container `migrapilot` | The one icon that opens the product. |
| Notification | Open MigraPilot `openMigraPilot` | Sends a person to the product surface; was worded "Open Command Center". |

### supporting-product-state — 16

| Kind | Surface | Why |
|---|---|---|
| Navigation | Conversations `nav-conversations` | Task context the user needs to resume work. |
| Navigation | Current workspace `nav-workspace` | Repo, branch, changed files, readiness. |
| Context panel | Workspace Context `ctx-workspace` | Where the work is happening. |
| Context panel | Active Run `ctx-run` | “What it is currently doing” — required by the product brief. |
| Context panel | Context Files `ctx-files` | What MigraPilot is reading, which the user must be able to see. |
| Context panel | Recent Activity `ctx-activity` | What just happened in this session. |
| Header | Settings `settings` | Opens VS Code settings, scoped to the product ones. |
| Composer | Live knowledge `clive` | A REAL user decision: whether anything leaves this machine for this turn. |
| Sidebar row | Settings `settings` | Opens VS Code settings scoped to MigraPilot. |
| Sidebar section | Recent `nav-recent` | Task history a user resumes work from. |
| Sidebar section | Workspace `nav-workspace` | Repo, branch and how much has changed. |
| Status | Shell status line `statusrow` | Where you are working and whether MigraPilot is ready — nothing else. |
| Status | Status bar: readiness `statusbar.readiness` | One glanceable answer to "can MigraPilot work right now"; opens MigraPilot. |
| Setting | Memory mode `migrapilot.memoryMode` | Whether conversations persist is the user’s choice. |
| Setting | Auto-apply changes `migrapilot.autoApplyChangeset` | How much approval the user wants is their choice. |
| Setting | Telemetry `migrapilot.enableTelemetry` | A privacy choice belongs to the user. |

### internal-diagnostics — 43

| Kind | Surface | Why |
|---|---|---|
| Command | Developer Diagnostics `showDiagnostics` | THE DOOR. The one engineering entry left in the normal palette, so developer mode is discoverable without shipping the rest. |
| Command | Check Health `health` | Brain lifecycle state. The product should recover, not ask the user to check. |
| Command | Repair Connection `repairConnection` | Service lifecycle control. |
| Command | Show Logs `showLogs` | Runtime troubleshooting. |
| Command | Production Diagnostics `productionDiagnostics` | Operational readout. |
| Command | Backend Selection Diagnostics `showBackendDiagnostics` | Routing internals. |
| Command | Providers (Read-Only) `providerStatus` | Model inventory. The product picks the model; the user does not. |
| Command | MigraAI Workspace `openWorkspacePanel` | Index internals: chunks, embedding model, schema, engine version. |
| Command | Agent Mode `openAgentMode` | Execution mechanics. Its outcomes are delivered by the product actions instead. |
| Tab | Agent Workspace `agent` | Recipes, activation, proposal mechanics. |
| Tab | Audit Trail `audit` | Engineering audit internals. |
| Tab | Workspace `workspace` | Index internals, model inventory, schema and protocol versions. |
| Navigation | Agent Mode status `nav-agent` | Lifecycle state of an internal mechanism. |
| Navigation | Tools & Services `nav-tools` | Brain Service, Local Models, Policy Engine, Audit Store — operations, not work. |
| Context panel | Brain Service Status `ctx-brain` | Service lifecycle detail. The header badge already says whether MigraPilot is ready. |
| Context panel | Agent Context `ctx-agent` | Pairing and activation mechanics. |
| Header | Agent Mode `agentMode` | Mechanism, not outcome. |
| Header | Audit `audit` | Engineering audit internals. |
| Header | Run History `runHistory` | Execution-engine evidence. |
| Composer | Model routing `croute` | The product picks the model. Exposing routing makes the user operate the backend. |
| Composer | Evidence source `csource` | Governance machinery. The provenance LINE stays — the host still states which source answered; only the control is withdrawn. |
| Sidebar row | Submit Agent Task `submitTask` | Agent Mode is a mechanism; a task asks for permission when it needs it. |
| Sidebar row | Active Runs `activeRuns` | Execution-engine state; progress belongs to the task that is running. |
| Sidebar row | Run History `runHistory` | Engineering audit evidence. |
| Sidebar row | Brain Status `brainStatus` | Service lifecycle. The readiness badge already answers the user question. |
| Sidebar row | Repair Connection `repairConnection` | Service lifecycle control the product should not delegate to a user. |
| Sidebar row | Logs `logs` | Runtime troubleshooting. |
| Sidebar section | Agent Mode section `nav-agent-actions` | A permanent Agent Mode console is exactly what the product must not be. |
| Sidebar section | Tools & Services `nav-tools` | Brain Service, Local Models, Policy Engine, Audit Store — operations, not work. |
| Sidebar section | Service section `nav-service-actions` | Brain lifecycle controls. |
| Notification | Show Logs `showLogs` | Offered when a lane cannot reach the engine; the output channel is a developer read. |
| Status | Status bar: Agent Mode `statusbar.agentMode` | Lifecycle state of a mechanism the product does not ask users to run. |
| Setting | Brain URL `migrapilot.brainUrl` | Raw service address. |
| Setting | Transcribe URL `migrapilot.transcribeUrl` | Raw service address. |
| Setting | Pilot API URL `migrapilot.pilotApiUrl` | Raw service address. |
| Setting | Backend mode `migrapilot.mode` | Deployment topology. |
| Setting | Auto-start Brain `migrapilot.autoStartBrain` | Service lifecycle. |
| Setting | Brain start command `migrapilot.brainAutoStartCommand` | Service lifecycle. |
| Setting | Request timeout `migrapilot.requestTimeoutMs` | Backend tuning with no meaning to a person writing code. |
| Setting | Max context chunks `migrapilot.maxContextChunks` | Index internals. |
| Setting | Capability contract path `migrapilot.capabilityContractPath` | Build-time wiring. |
| Setting | Workspace agent `migrapilot.enableWorkspaceAgent` | Mechanism toggle. |
| Setting | Developer mode `migrapilot.developerMode` | The switch that reveals every surface above. |

### control-plane — 8

| Kind | Surface | Why |
|---|---|---|
| Command | Execution Policy `executionPolicy` | Policy administration belongs in the Migra control panel. |
| Command | AI Usage & Budget `aiUsage` | Plans and usage are account administration. |
| Command | Set Service Token `setToken` | Credential administration. |
| Command | Clear Service Token `clearToken` | Credential administration. |
| Command | Pair Agent Mode `pairAgentMode` | Pairing mechanics — a provisioning act, not a coding one. |
| Status | Status bar: execution policy `statusbar.policy` | Policy administration, permanently parked in the editor chrome. |
| Setting | Pilot API token `migrapilot.pilotApiToken` | A credential, administered centrally rather than typed here. |
| Setting | Pilot API auth mode `migrapilot.pilotApiAuthMode` | Credential handling. |

### legacy-duplicate — 8

| Kind | Surface | Why |
|---|---|---|
| Command | Classic Chat `dev.openClassicChat` | Replaced by the shell. Already gated on enableClassicViews. |
| Command | Classic Agent Mode `dev.openClassicAgentMode` | Replaced by the shell. Already gated. |
| Command | Classic Workspace `dev.openClassicWorkspace` | Replaced by the shell. Already gated. |
| View | Chat (Classic) `migrapilot.chatView` | Gated on enableClassicViews. |
| View | Agent Mode (Classic) `migrapilot.agentMode` | Gated on enableClassicViews. |
| View | MigraAI Workspace (Classic) `migrapilot.workspace` | Gated on enableClassicViews. |
| Notification | Enable Classic Views `enableClassicViews` | Only offered by the already-gated classic developer commands. |
| Setting | Classic views `migrapilot.enableClassicViews` | Keeps superseded surfaces reachable. |

### placeholder

None.

## Acceptance

Proven twice: once in the harness, once by eye.

**In a real VS Code, against a real project on disk**
([`src/test/suite/productSurface.test.ts`](../src/test/suite/productSurface.test.ts)) — a
whole coding task with no engineering surface anywhere in it:

1. the default install renders the product and none of the engineering markup;
2. no engineering slash command is typeable;
3. **Run Tests** reports the real failure and names it — *"total sums every item"*;
4. the fix is proposed read-only, the diff shows the actual file content, it is approved and
   applied through the engine's mint → consume handshake, and the file on disk really changes;
5. **Run Tests** run again reports `passed` — same command, new answer;
6. **Review Changes** reports the file the task changed;
7. every command the task needed is classified `core-product`.

**From the packaged VSIX, in a real window, photographed.** The same journey driven through
the installed artifact with `developerMode` confirmed off, capturing the **sidebar**, the Ask
surface, the failing run, the passing run and the Changes surface — plus the sidebar again
with `developerMode` on, to prove developer mode restores every engineering section live,
without a window reload, while `Run Tests` still passes. This is what found the status-surface
leaks and the whole sidebar; nothing in the source review did.

The extension unit suite is **840/840**. The `test:vsix`-only governed-coding suite is the
single integration failure and predates this work: its fixture is seeded exclusively by
`runTestVsix.ts`, so it cannot pass under `test:integration`. Recorded as fixture-architecture
debt, not normalised away — `test:integration` should eventually have one authoritative setup
path.
