// MigraPilot — WHAT THE PRODUCT SHOWS, and what it does not.
//
// The locked distinction:
//
//   PRODUCT UI     what a user needs to accomplish work
//   CONTROL PLANE  users, permissions, plans, usage, policies, system health,
//                  service configuration, administrative controls
//   ENGINEERING    internal diagnostics, model operations, deployment, index
//                  internals, low-level runtime troubleshooting
//
// The normal interface exposes ONLY `core-product` and `supporting-product-state`.
// Everything else is reachable in developer mode or not at all — and none of it is
// deleted, because the backend capability behind these surfaces is real and stays.
//
// This file is the single source of truth for that split. It is a classification,
// not a description: `shellHtml` builds the document from it, the palette gating in
// package.json mirrors it, and a test fails if a surface is unclassified or if an
// engineering surface becomes reachable from the product UI. Writing the rule down
// in a document would let the two drift; here they cannot.

export type SurfaceClass =
  /** The user's actual work: ask, understand, act, review, verify, see the result. */
  | 'core-product'
  /** State the user needs in order to trust the work — repo, branch, what changed. */
  | 'supporting-product-state'
  /** Useful to us as builders. Model names, index internals, lifecycle, schema. */
  | 'internal-diagnostics'
  /** Administrative: belongs in the central Migra control panel, not in the editor. */
  | 'control-plane'
  /** Superseded by a surface that does the same thing better. */
  | 'legacy-duplicate'
  /** Declared but not delivering an outcome. */
  | 'placeholder';

/** The two classes the normal interface may show. */
export const PRODUCT_CLASSES: readonly SurfaceClass[] = ['core-product', 'supporting-product-state'];

export type SurfaceKind =
  | 'command'
  | 'view'
  | 'tab'
  | 'nav-section'
  | 'context-panel'
  | 'header-action'
  | 'composer-control'
  /** The shell's status line and MigraPilot's items in VS Code's status bar. */
  | 'status'
  /** Rows in the Activity Bar sidebar (`navigationHtml`). */
  | 'nav-action'
  /** Sections of that sidebar. */
  | 'nav-region'
  /** Editor right-click entries. */
  | 'context-menu'
  /** Activity Bar containers. */
  | 'activity-bar'
  /** Buttons offered on a notification. */
  | 'notification-action'
  | 'setting';

export interface SurfaceRecord {
  /** Command id without the `migrapilot.` prefix, or the element/region id. */
  id: string;
  kind: SurfaceKind;
  label: string;
  cls: SurfaceClass;
  /** Why it is classified this way. Present on every record. */
  why: string;
}

export const SURFACES: readonly SurfaceRecord[] = [
  // ── Commands: the user's work ───────────────────────────────────────────────
  { id: 'openStudio', kind: 'command', label: 'Open MigraPilot', cls: 'core-product', why: 'The product surface itself.' },
  { id: 'openChat', kind: 'command', label: 'Ask MigraPilot', cls: 'core-product', why: 'Where you ask. The entry point of the journey.' },
  { id: 'quickEdit', kind: 'command', label: 'Fix Code', cls: 'core-product', why: 'Ask for a change, see the diff, apply it.' },
  { id: 'governedCoding', kind: 'command', label: 'Make a Code Change', cls: 'core-product', why: 'The larger propose → review → apply path for real work.' },
  { id: 'explainSelection', kind: 'command', label: 'Explain Code', cls: 'core-product', why: 'Understand the repository — a named outcome.' },
  { id: 'fixDiagnostics', kind: 'command', label: 'Fix Problems in This File', cls: 'core-product', why: 'Acts on the errors the editor already shows.' },
  { id: 'gitOverview', kind: 'command', label: 'Review Changes', cls: 'core-product', why: 'What changed, on what branch, by whom.' },
  { id: 'runTests', kind: 'command', label: 'Run Tests', cls: 'core-product', why: 'Verification — the step that decides whether work is done.' },
  { id: 'runCommand', kind: 'command', label: 'Run a Command', cls: 'core-product', why: 'Running the project’s own tooling is ordinary coding work.' },
  { id: 'diagnoseFailure', kind: 'command', label: 'Debug a Failure', cls: 'core-product', why: 'Explains why something failed. A user outcome, despite the name.' },
  { id: 'generateTests', kind: 'command', label: 'Write Tests', cls: 'core-product', why: 'Produces code the user keeps.' },
  { id: 'generateCommit', kind: 'command', label: 'Write a Commit Message', cls: 'core-product', why: 'Produces text the user keeps.' },
  { id: 'reviewApprovals', kind: 'command', label: 'Review Pending Actions', cls: 'core-product', why: 'Approval IS a decision the user must make — it stays in the product.' },

  // ── Commands: engineering ──────────────────────────────────────────────────
  { id: 'showDiagnostics', kind: 'command', label: 'Developer Diagnostics', cls: 'internal-diagnostics', why: 'THE DOOR. The one engineering entry left in the normal palette, so developer mode is discoverable without shipping the rest.' },
  { id: 'health', kind: 'command', label: 'Check Health', cls: 'internal-diagnostics', why: 'Brain lifecycle state. The product should recover, not ask the user to check.' },
  { id: 'repairConnection', kind: 'command', label: 'Repair Connection', cls: 'internal-diagnostics', why: 'Service lifecycle control.' },
  { id: 'showLogs', kind: 'command', label: 'Show Logs', cls: 'internal-diagnostics', why: 'Runtime troubleshooting.' },
  { id: 'productionDiagnostics', kind: 'command', label: 'Production Diagnostics', cls: 'internal-diagnostics', why: 'Operational readout.' },
  { id: 'showBackendDiagnostics', kind: 'command', label: 'Backend Selection Diagnostics', cls: 'internal-diagnostics', why: 'Routing internals.' },
  { id: 'providerStatus', kind: 'command', label: 'Providers (Read-Only)', cls: 'internal-diagnostics', why: 'Model inventory. The product picks the model; the user does not.' },
  { id: 'openWorkspacePanel', kind: 'command', label: 'MigraAI Workspace', cls: 'internal-diagnostics', why: 'Index internals: chunks, embedding model, schema, engine version.' },
  { id: 'openAgentMode', kind: 'command', label: 'Agent Mode', cls: 'internal-diagnostics', why: 'Execution mechanics. Its outcomes are delivered by the product actions instead.' },

  // ── Commands: administrative ───────────────────────────────────────────────
  { id: 'executionPolicy', kind: 'command', label: 'Execution Policy', cls: 'control-plane', why: 'Policy administration belongs in the Migra control panel.' },
  { id: 'aiUsage', kind: 'command', label: 'AI Usage & Budget', cls: 'control-plane', why: 'Plans and usage are account administration.' },
  { id: 'setToken', kind: 'command', label: 'Set Service Token', cls: 'control-plane', why: 'Credential administration.' },
  { id: 'clearToken', kind: 'command', label: 'Clear Service Token', cls: 'control-plane', why: 'Credential administration.' },
  { id: 'pairAgentMode', kind: 'command', label: 'Pair Agent Mode', cls: 'control-plane', why: 'Pairing mechanics — a provisioning act, not a coding one.' },

  // ── Commands: superseded ───────────────────────────────────────────────────
  { id: 'dev.openClassicChat', kind: 'command', label: 'Classic Chat', cls: 'legacy-duplicate', why: 'Replaced by the shell. Already gated on enableClassicViews.' },
  { id: 'dev.openClassicAgentMode', kind: 'command', label: 'Classic Agent Mode', cls: 'legacy-duplicate', why: 'Replaced by the shell. Already gated.' },
  { id: 'dev.openClassicWorkspace', kind: 'command', label: 'Classic Workspace', cls: 'legacy-duplicate', why: 'Replaced by the shell. Already gated.' },

  // ── Views ──────────────────────────────────────────────────────────────────
  { id: 'migrapilot.sidebar', kind: 'view', label: 'MigraPilot', cls: 'core-product', why: 'The one view a normal install shows.' },
  { id: 'migrapilot.chatView', kind: 'view', label: 'Chat (Classic)', cls: 'legacy-duplicate', why: 'Gated on enableClassicViews.' },
  { id: 'migrapilot.agentMode', kind: 'view', label: 'Agent Mode (Classic)', cls: 'legacy-duplicate', why: 'Gated on enableClassicViews.' },
  { id: 'migrapilot.workspace', kind: 'view', label: 'MigraAI Workspace (Classic)', cls: 'legacy-duplicate', why: 'Gated on enableClassicViews.' },

  // ── Shell tabs ─────────────────────────────────────────────────────────────
  { id: 'chat', kind: 'tab', label: 'Ask', cls: 'core-product', why: 'Ask, and read the result.' },
  { id: 'diff', kind: 'tab', label: 'Changes', cls: 'core-product', why: '“Show me the diff” is step five of the journey.' },
  { id: 'agent', kind: 'tab', label: 'Agent Workspace', cls: 'internal-diagnostics', why: 'Recipes, activation, proposal mechanics.' },
  { id: 'audit', kind: 'tab', label: 'Audit Trail', cls: 'internal-diagnostics', why: 'Engineering audit internals.' },
  { id: 'workspace', kind: 'tab', label: 'Workspace', cls: 'internal-diagnostics', why: 'Index internals, model inventory, schema and protocol versions.' },

  // ── Navigation sections ────────────────────────────────────────────────────
  { id: 'nav-conversations', kind: 'nav-section', label: 'Conversations', cls: 'supporting-product-state', why: 'Task context the user needs to resume work.' },
  { id: 'nav-workspace', kind: 'nav-section', label: 'Current workspace', cls: 'supporting-product-state', why: 'Repo, branch, changed files, readiness.' },
  { id: 'nav-agent', kind: 'nav-section', label: 'Agent Mode status', cls: 'internal-diagnostics', why: 'Lifecycle state of an internal mechanism.' },
  { id: 'nav-tools', kind: 'nav-section', label: 'Tools & Services', cls: 'internal-diagnostics', why: 'Brain Service, Local Models, Policy Engine, Audit Store — operations, not work.' },

  // ── Context panels ─────────────────────────────────────────────────────────
  { id: 'ctx-workspace', kind: 'context-panel', label: 'Workspace Context', cls: 'supporting-product-state', why: 'Where the work is happening.' },
  { id: 'ctx-run', kind: 'context-panel', label: 'Active Run', cls: 'supporting-product-state', why: '“What it is currently doing” — required by the product brief.' },
  { id: 'ctx-files', kind: 'context-panel', label: 'Context Files', cls: 'supporting-product-state', why: 'What MigraPilot is reading, which the user must be able to see.' },
  { id: 'ctx-activity', kind: 'context-panel', label: 'Recent Activity', cls: 'supporting-product-state', why: 'What just happened in this session.' },
  { id: 'ctx-brain', kind: 'context-panel', label: 'Brain Service Status', cls: 'internal-diagnostics', why: 'Service lifecycle detail. The header badge already says whether MigraPilot is ready.' },
  { id: 'ctx-agent', kind: 'context-panel', label: 'Agent Context', cls: 'internal-diagnostics', why: 'Pairing and activation mechanics.' },

  // ── Header actions ─────────────────────────────────────────────────────────
  { id: 'newTask', kind: 'header-action', label: 'New Task', cls: 'core-product', why: 'Start fresh work.' },
  { id: 'settings', kind: 'header-action', label: 'Settings', cls: 'supporting-product-state', why: 'Opens VS Code settings, scoped to the product ones.' },
  { id: 'agentMode', kind: 'header-action', label: 'Agent Mode', cls: 'internal-diagnostics', why: 'Mechanism, not outcome.' },
  { id: 'audit', kind: 'header-action', label: 'Audit', cls: 'internal-diagnostics', why: 'Engineering audit internals.' },
  { id: 'runHistory', kind: 'header-action', label: 'Run History', cls: 'internal-diagnostics', why: 'Execution-engine evidence.' },

  // ── Composer controls ──────────────────────────────────────────────────────
  { id: 'clive', kind: 'composer-control', label: 'Live knowledge', cls: 'supporting-product-state', why: 'A REAL user decision: whether anything leaves this machine for this turn.' },
  { id: 'ccontext', kind: 'composer-control', label: 'Attach context', cls: 'core-product', why: 'Choosing what MigraPilot looks at is part of asking.' },
  { id: 'cattach', kind: 'composer-control', label: 'Attach file', cls: 'core-product', why: 'Attaching a file is part of asking a question well.' },
  { id: 'cmic', kind: 'composer-control', label: 'Dictate', cls: 'core-product', why: 'Speaking the question is another way of asking it.' },
  { id: 'croute', kind: 'composer-control', label: 'Model routing', cls: 'internal-diagnostics', why: 'The product picks the model. Exposing routing makes the user operate the backend.' },
  { id: 'csource', kind: 'composer-control', label: 'Evidence source', cls: 'internal-diagnostics', why: 'Governance machinery. The provenance LINE stays — the host still states which source answered; only the control is withdrawn.' },

  // ── Sidebar rows (the Activity Bar view — the surface opened FIRST) ────────
  //
  // This whole surface was missed by the first pass of the pivot: it is rendered
  // by `navigationHtml.ts`, not `shellHtml.ts`, and shipped the console intact.
  { id: 'newTask', kind: 'nav-action', label: 'New Task', cls: 'core-product', why: 'Starting work is what a person opened the sidebar to do.' },
  { id: 'explainCode', kind: 'nav-action', label: 'Explain Code', cls: 'core-product', why: 'Understand the repository — step two of the journey.' },
  { id: 'fixCode', kind: 'nav-action', label: 'Fix Code', cls: 'core-product', why: 'Describe a change, see the diff, apply it.' },
  { id: 'reviewChanges', kind: 'nav-action', label: 'Review Changes', cls: 'core-product', why: 'See what changed before trusting it.' },
  { id: 'runTests', kind: 'nav-action', label: 'Run Tests', cls: 'core-product', why: 'Verification decides whether the work is done.' },
  { id: 'pendingApprovals', kind: 'nav-action', label: 'Needs your approval', cls: 'core-product', why: 'A real decision only the user can make — and shown ONLY when one is waiting.' },
  { id: 'settings', kind: 'nav-action', label: 'Settings', cls: 'supporting-product-state', why: 'Opens VS Code settings scoped to MigraPilot.' },
  { id: 'submitTask', kind: 'nav-action', label: 'Submit Agent Task', cls: 'internal-diagnostics', why: 'Agent Mode is a mechanism; a task asks for permission when it needs it.' },
  { id: 'activeRuns', kind: 'nav-action', label: 'Active Runs', cls: 'internal-diagnostics', why: 'Execution-engine state; progress belongs to the task that is running.' },
  { id: 'runHistory', kind: 'nav-action', label: 'Run History', cls: 'internal-diagnostics', why: 'Engineering audit evidence.' },
  { id: 'brainStatus', kind: 'nav-action', label: 'Brain Status', cls: 'internal-diagnostics', why: 'Service lifecycle. The readiness badge already answers the user question.' },
  { id: 'repairConnection', kind: 'nav-action', label: 'Repair Connection', cls: 'internal-diagnostics', why: 'Service lifecycle control the product should not delegate to a user.' },
  { id: 'logs', kind: 'nav-action', label: 'Logs', cls: 'internal-diagnostics', why: 'Runtime troubleshooting.' },

  // ── Sidebar sections ──────────────────────────────────────────────────────
  { id: 'nav-recent', kind: 'nav-region', label: 'Recent', cls: 'supporting-product-state', why: 'Task history a user resumes work from.' },
  { id: 'nav-workspace', kind: 'nav-region', label: 'Workspace', cls: 'supporting-product-state', why: 'Repo, branch and how much has changed.' },
  { id: 'nav-quick', kind: 'nav-region', label: 'Quick Actions', cls: 'core-product', why: 'Four outcomes, one click each.' },
  { id: 'nav-approvals', kind: 'nav-region', label: 'Approval prompt', cls: 'core-product', why: 'Appears only when a decision is actually pending.' },
  { id: 'nav-agent-actions', kind: 'nav-region', label: 'Agent Mode section', cls: 'internal-diagnostics', why: 'A permanent Agent Mode console is exactly what the product must not be.' },
  { id: 'nav-tools', kind: 'nav-region', label: 'Tools & Services', cls: 'internal-diagnostics', why: 'Brain Service, Local Models, Policy Engine, Audit Store — operations, not work.' },
  { id: 'nav-service-actions', kind: 'nav-region', label: 'Service section', cls: 'internal-diagnostics', why: 'Brain lifecycle controls.' },

  // ── Editor context menu + Activity Bar ────────────────────────────────────
  { id: 'migrapilot.explainSelection', kind: 'context-menu', label: 'Explain Code (right-click)', cls: 'core-product', why: 'IDE-native entry to a product outcome, on a real selection.' },
  { id: 'migrapilot.fixDiagnostics', kind: 'context-menu', label: 'Fix Problems (right-click)', cls: 'core-product', why: 'Acts on the errors the editor already shows.' },
  { id: 'migrapilot', kind: 'activity-bar', label: 'MigraPilot container', cls: 'core-product', why: 'The one icon that opens the product.' },

  // ── Notification actions ──────────────────────────────────────────────────
  { id: 'openMigraPilot', kind: 'notification-action', label: 'Open MigraPilot', cls: 'core-product', why: 'Sends a person to the product surface; was worded "Open Command Center".' },
  { id: 'enableClassicViews', kind: 'notification-action', label: 'Enable Classic Views', cls: 'legacy-duplicate', why: 'Only offered by the already-gated classic developer commands.' },
  { id: 'showLogs', kind: 'notification-action', label: 'Show Logs', cls: 'internal-diagnostics', why: 'Offered when a lane cannot reach the engine; the output channel is a developer read.' },

  // ── Status surfaces ────────────────────────────────────────────────────────
  //
  // Missed by the first pass of this audit and caught by LOOKING AT THE RUNNING
  // PRODUCT: the shell's status line read "Brain: Healthy · Schema: v0 · Policy:
  // auto · Agent Mode: Off", and VS Code's own status bar carried "MigraPilot:
  // local", "auto" and "Agent Mode: OFF". Reading the code found none of it.
  { id: 'statusrow', kind: 'status', label: 'Shell status line', cls: 'supporting-product-state', why: 'Where you are working and whether MigraPilot is ready — nothing else.' },
  { id: 'statusbar.readiness', kind: 'status', label: 'Status bar: readiness', cls: 'supporting-product-state', why: 'One glanceable answer to "can MigraPilot work right now"; opens MigraPilot.' },
  { id: 'statusbar.policy', kind: 'status', label: 'Status bar: execution policy', cls: 'control-plane', why: 'Policy administration, permanently parked in the editor chrome.' },
  { id: 'statusbar.agentMode', kind: 'status', label: 'Status bar: Agent Mode', cls: 'internal-diagnostics', why: 'Lifecycle state of a mechanism the product does not ask users to run.' },

  // ── Settings ───────────────────────────────────────────────────────────────
  { id: 'migrapilot.memoryMode', kind: 'setting', label: 'Memory mode', cls: 'supporting-product-state', why: 'Whether conversations persist is the user’s choice.' },
  { id: 'migrapilot.autoApplyChangeset', kind: 'setting', label: 'Auto-apply changes', cls: 'supporting-product-state', why: 'How much approval the user wants is their choice.' },
  { id: 'migrapilot.enableTelemetry', kind: 'setting', label: 'Telemetry', cls: 'supporting-product-state', why: 'A privacy choice belongs to the user.' },
  { id: 'migrapilot.brainUrl', kind: 'setting', label: 'Brain URL', cls: 'internal-diagnostics', why: 'Raw service address.' },
  { id: 'migrapilot.transcribeUrl', kind: 'setting', label: 'Transcribe URL', cls: 'internal-diagnostics', why: 'Raw service address.' },
  { id: 'migrapilot.pilotApiUrl', kind: 'setting', label: 'Pilot API URL', cls: 'internal-diagnostics', why: 'Raw service address.' },
  { id: 'migrapilot.mode', kind: 'setting', label: 'Backend mode', cls: 'internal-diagnostics', why: 'Deployment topology.' },
  { id: 'migrapilot.autoStartBrain', kind: 'setting', label: 'Auto-start Brain', cls: 'internal-diagnostics', why: 'Service lifecycle.' },
  { id: 'migrapilot.brainAutoStartCommand', kind: 'setting', label: 'Brain start command', cls: 'internal-diagnostics', why: 'Service lifecycle.' },
  { id: 'migrapilot.requestTimeoutMs', kind: 'setting', label: 'Request timeout', cls: 'internal-diagnostics', why: 'Backend tuning with no meaning to a person writing code.' },
  { id: 'migrapilot.maxContextChunks', kind: 'setting', label: 'Max context chunks', cls: 'internal-diagnostics', why: 'Index internals.' },
  { id: 'migrapilot.capabilityContractPath', kind: 'setting', label: 'Capability contract path', cls: 'internal-diagnostics', why: 'Build-time wiring.' },
  { id: 'migrapilot.enableWorkspaceAgent', kind: 'setting', label: 'Workspace agent', cls: 'internal-diagnostics', why: 'Mechanism toggle.' },
  { id: 'migrapilot.enableClassicViews', kind: 'setting', label: 'Classic views', cls: 'legacy-duplicate', why: 'Keeps superseded surfaces reachable.' },
  { id: 'migrapilot.developerMode', kind: 'setting', label: 'Developer mode', cls: 'internal-diagnostics', why: 'The switch that reveals every surface above.' },
  { id: 'migrapilot.pilotApiToken', kind: 'setting', label: 'Pilot API token', cls: 'control-plane', why: 'A credential, administered centrally rather than typed here.' },
  { id: 'migrapilot.pilotApiAuthMode', kind: 'setting', label: 'Pilot API auth mode', cls: 'control-plane', why: 'Credential handling.' },
];

const BY_KEY = new Map(SURFACES.map((s) => [`${s.kind}:${s.id}`, s]));

export function classify(kind: SurfaceKind, id: string): SurfaceRecord | undefined {
  return BY_KEY.get(`${kind}:${id}`);
}

/**
 * Is this surface allowed in the normal interface?
 *
 * Fails CLOSED: an id nobody classified is treated as not-product, so adding a new
 * engineering surface and forgetting to classify it hides it rather than shipping it.
 */
export function isProductSurface(kind: SurfaceKind, id: string): boolean {
  const record = classify(kind, id);
  return record !== undefined && PRODUCT_CLASSES.includes(record.cls);
}

/** Surfaces of a kind that the current mode may show. */
export function visibleSurfaces(kind: SurfaceKind, developerMode: boolean): SurfaceRecord[] {
  return SURFACES.filter((s) => s.kind === kind && (developerMode || PRODUCT_CLASSES.includes(s.cls)));
}

/** Ids of a kind visible in the current mode, in declaration order. */
export function visibleIds(kind: SurfaceKind, developerMode: boolean): string[] {
  return visibleSurfaces(kind, developerMode).map((s) => s.id);
}

export function surfacesOfClass(cls: SurfaceClass): SurfaceRecord[] {
  return SURFACES.filter((s) => s.cls === cls);
}
