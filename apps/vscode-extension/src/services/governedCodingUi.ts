// MigraPilot — the human-interaction boundary for governed coding.
//
// Every point where the command waits on a PERSON goes through this interface.
// Nothing else does: the workspace, the Brain client, repository paths, durable
// snapshots, mutation decisions and completion state all stay real on both sides
// of it.
//
// It exists because the packaged acceptance was blocked trying to intercept
// `vscode.window` — the namespace the installed command actually calls is not the
// object a test can replace. Rather than escalating that fight, the dependency is
// declared. The installed proof still drives the real contributed command, the
// real handler, real workspace resolution, real orchestration, the real Brain API,
// the real journal and real mutation; only the human's answers are scripted, which
// is supplying controlled input rather than mocking the thing under test.
//
// A second benefit is worth stating: with the dialogs behind a typed interface,
// every awaited user decision has exactly one outcome, and DISMISSAL IS A DISTINCT
// VALUE. A `string | undefined` from a modal invites treating "closed the dialog"
// as "said no", and rejecting a scope the operator never answered is a decision
// nobody made.
//
// vscode-free by construction — the adapter that touches VS Code lives in
// governedCodingUiVscode.ts.

export interface ScopeApprovalViewModel {
  runId: string;
  revision: number;
  pathSetHash: string;
  expiresAt: string;
  issueSummary?: string;
  files: Array<{ path: string; rationale: string; evidence: Array<{ startLine: number; endLine: number; excerptHash: string }> }>;
  excluded: Array<{ path: string; reason: string }>;
  /** True when this proposal replaced one the operator already saw. */
  supersededPreviousProposal: boolean;
  /** Pre-rendered for display surfaces; the fields above stay authoritative. */
  title: string;
  markdown: string;
  modalDetail: string;
}

export interface CodingProgressViewModel {
  runId: string;
  revision: number;
  phaseLabel: string;
  busy: boolean;
  steps: Array<{ label: string; outcome: string; attempt: number }>;
}

export interface CodingFinalReportViewModel {
  runId: string;
  revision: number;
  state: string;
  complete: boolean;
  changedFiles: string[];
  markdown: string;
}

export interface CodingErrorViewModel {
  title: string;
  detail: string;
  recoverable: boolean;
}

/** What the operator answered. `dismiss` is NOT `reject`. */
export type ScopeApprovalAnswer = 'approve' | 'reject' | 'dismiss';
export type CancellationAnswer = 'cancel-run' | 'stop-watching' | 'dismiss';

export interface GovernedCodingUi {
  requestIssueText(): Promise<string | undefined>;
  presentScopeApproval(model: ScopeApprovalViewModel): Promise<ScopeApprovalAnswer>;
  presentCancellationChoice(): Promise<CancellationAnswer>;
  showProgress(model: CodingProgressViewModel): Promise<void>;
  showFinalReport(model: CodingFinalReportViewModel): Promise<void>;
  showError(model: CodingErrorViewModel): Promise<void>;
}

/**
 * Holds the active UI so the packaged acceptance can supply a scripted one.
 *
 * A holder rather than a constructor argument because the command is registered
 * once at activation, and the installed proof must drive THAT registration rather
 * than a second copy. Production never calls `set` — activation installs the VS
 * Code adapter and nothing replaces it.
 */
export type GovernedCodingUiFactory = (progress?: { report(value: { message?: string }): void }) => GovernedCodingUi;

export class GovernedCodingUiHolder {
  constructor(private factory: GovernedCodingUiFactory) {}
  /** Build the UI for one command invocation. The progress handle is offered so
   * the VS Code adapter can report into the notification; a scripted UI ignores it. */
  create(progress?: { report(value: { message?: string }): void }): GovernedCodingUi {
    return this.factory(progress);
  }
  /** Supply a scripted UI. Called only by the packaged acceptance. */
  set(factory: GovernedCodingUiFactory): void { this.factory = factory; }
}

/**
 * Wrap a UI so an adapter failure becomes an explicit command failure.
 *
 * A dialog implementation that throws must not read as a dismissal: "the surface
 * broke" and "the operator closed it" lead to opposite conclusions about whether
 * anyone decided anything.
 */
export class UiAdapterError extends Error {
  constructor(readonly operation: string, cause: unknown) {
    super(`the governed coding UI failed during ${operation}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'UiAdapterError';
  }
}

export function guardUi(ui: GovernedCodingUi): GovernedCodingUi {
  const wrap = <T>(operation: string, fn: () => Promise<T>): Promise<T> =>
    fn().catch((cause: unknown) => { throw new UiAdapterError(operation, cause); });
  return {
    requestIssueText: () => wrap('requestIssueText', () => ui.requestIssueText()),
    presentScopeApproval: (m) => wrap('presentScopeApproval', () => ui.presentScopeApproval(m)),
    presentCancellationChoice: () => wrap('presentCancellationChoice', () => ui.presentCancellationChoice()),
    showProgress: (m) => wrap('showProgress', () => ui.showProgress(m)),
    showFinalReport: (m) => wrap('showFinalReport', () => ui.showFinalReport(m)),
    showError: (m) => wrap('showError', () => ui.showError(m)),
  };
}
