/**
 * MigraPilot Interaction Verification — the contracts.
 *
 * See `docs/architecture/interaction-verification-system.md`. This slice implements the
 * VS Code command adapter only: identity, locator, baseline, one trace, one report.
 *
 * The types live in the extension rather than `@migrapilot/protocol` on purpose. Identity
 * carries an `applicationId` because it will eventually span hosts, but nothing outside this
 * extension consumes these yet, and widening the shared package before a second consumer
 * exists would freeze a shape that has been exercised exactly once.
 */

/** What a control's invocation can do. Unknown must be treated as the most dangerous. */
export const CONTROL_CONSEQUENCES = ['read-only', 'mutating', 'approval', 'destructive'] as const;
export type ControlConsequence = (typeof CONTROL_CONSEQUENCES)[number];

/**
 * How confident the locator is that it found the right control.
 *
 * `exact` is a host-guaranteed handle. Everything below it is a guess of decreasing quality,
 * and the tier travels into the report so a reader never has to assume which was used.
 */
export const LOCATOR_CONFIDENCES = ['exact', 'semantic', 'heuristic', 'positional'] as const;
export type LocatorConfidence = (typeof LOCATOR_CONFIDENCES)[number];

/** What the control's effect is scoped to — decides what must be isolated and restored. */
export const INSTANCE_SCOPES = ['global', 'window', 'workspace', 'session', 'document'] as const;
export type InstanceScope = (typeof INSTANCE_SCOPES)[number];

/**
 * The durable contract: what this action IS, across releases, layouts and locales.
 *
 * Never derived from label text, DOM position, CSS class, coordinates, icon, localization or
 * layout order. Those are discovery attributes — fine for finding a control, invalid for
 * being one.
 */
export interface ControlIdentity {
  applicationId: string;
  surfaceId: string;
  controlId: string;
  /** Bumped when the control's MEANING changes, never for a label or an icon. */
  controlVersion: number;
  instanceScope: InstanceScope;
}

/** A VS Code command handle. The only adapter in this slice. */
export interface VsCodeCommandLocator {
  adapter: 'vscode-command';
  commandId: string;
  confidence: LocatorConfidence;
}

export type ControlLocator = VsCodeCommandLocator;

/** One control, declared beside its production registration point. */
export interface ControlDeclaration extends ControlIdentity {
  consequence: ControlConsequence;
  locator: ControlLocator;
}

/**
 * Stable key for a declaration.
 *
 * Includes the version, so two generations of one control are distinguishable — a trace
 * recorded against v1 must not silently replay against v2.
 */
export function identityKey(c: ControlIdentity): string {
  return `${c.applicationId}/${c.surfaceId}/${c.controlId}@v${c.controlVersion}`;
}

// ── baseline ─────────────────────────────────────────────────────────────────

/**
 * The environment before and after an interaction.
 *
 * "Unchanged" is deliberately NOT defined as `git status` alone. A control can leave a
 * setting written, a document dirty or a dialog pending without touching a tracked file, and
 * a baseline that only watches git would call that clean.
 *
 * Dimensions an adapter cannot capture are listed in `unverifiable` rather than omitted. A
 * missing dimension that looks captured is worse than one that admits it is absent.
 */
export interface InteractionBaseline {
  repository: {
    headSha: string | null;
    statusPorcelain: string[];
    trackedContentDigest?: string;
  };
  workspace: {
    configurationDigest: string | null;
    workspaceStateDigest: string | null;
  };
  editors: {
    openDocumentUris: string[];
    dirtyDocumentUris: string[];
    activeDocumentUri: string | null;
  };
  host: {
    pendingNotifications: number | null;
    pendingDialogs: number | null;
  };
  /** Dimension → why it could not be captured here. Surfaced in the report as gaps. */
  unverifiable: Record<string, string>;
}

/**
 * Named, comparable effects.
 *
 * A closed set rather than free-form diffing: an effect a trace cannot name is an effect it
 * cannot declare expected or forbidden, and silently-unclassified change is how a
 * verification system starts lying.
 */
export const EFFECT_KINDS = [
  'repository.headChanged',
  'repository.filesChanged',
  'workspace.configurationChanged',
  'workspace.stateChanged',
  'editors.documentOpened',
  'editors.documentClosed',
  'editors.activeChanged',
  'editors.preexistingDirtyModified',
  'host.pendingNotificationsRemain',
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export interface ObservedEffect {
  kind: EffectKind;
  detail: string;
}

// ── trace ────────────────────────────────────────────────────────────────────

export interface TraceBudget {
  /** Beyond this the interaction is `slow` — settled, but slower than declared. */
  settleMs: number;
  /** Beyond this it is `hung` — a defect, not a performance note. */
  ceilingMs: number;
}

export interface InteractionTrace {
  trace: string;
  /** The proof level this trace can produce. Never higher than its adapter reaches. */
  level: 1 | 2 | 3 | 4 | 5;
  control: ControlIdentity;
  locator: ControlLocator;
  budget: TraceBudget;
  /** Effects that MAY occur. Anything here is permitted, not required. */
  expected: EffectKind[];
  /** Effects that must NOT occur. One observation fails the trace. */
  forbidden: EffectKind[];
  /** Audit event types this interaction must produce, correlated by id. */
  expectAuditEvents?: string[];
}

/** settled inside budget · settled late · never settled. Never collapsed into pass/fail. */
export type TimingClassification = 'completed' | 'slow' | 'hung';

export type InteractionOutcome =
  | 'verified'
  | 'failed'
  /** Invocation accepted, nothing observable happened — the button that does nothing. */
  | 'inert'
  | 'hung'
  /** Declared but not present in the host: registration regression. */
  | 'undiscovered'
  /** Preconditions for safe execution could not be proven. */
  | 'refused';

export interface EvidenceReport {
  trace: string;
  outcome: InteractionOutcome;
  /** The level ACTUALLY reached, which may be lower than the trace requested. */
  levelReached: 1 | 2 | 3 | 4 | 5;
  control: ControlIdentity & { key: string };
  locator: ControlLocator & { resolved: boolean; downgradedFrom?: LocatorConfidence; downgradeReason?: string };
  registration: { commandFound: boolean; totalCommands: number };
  timing: { elapsedMs: number; classification: TimingClassification; budget: TraceBudget; waitingOn?: string };
  effects: {
    observed: ObservedEffect[];
    expected: EffectKind[];
    forbidden: EffectKind[];
    /** Observed and neither expected nor forbidden — unclassified change. */
    unexpected: ObservedEffect[];
    /** Observed and explicitly forbidden. Any entry fails the trace. */
    violations: ObservedEffect[];
  };
  correlation: { correlationId: string | null; auditEventTypes: string[]; auditMatched: boolean };
  cleanup: { verified: boolean; residual: ObservedEffect[] };
  /** Everything this run could not establish. Mandatory; empty only when truly empty. */
  evidenceGaps: string[];
  baselineBefore: InteractionBaseline;
  baselineAfter: InteractionBaseline;
}
