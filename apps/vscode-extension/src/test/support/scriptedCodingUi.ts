// MigraPilot — a deterministic governed-coding UI for the packaged acceptance.
//
// Supplies the human's answers and CAPTURES the view models the real command
// rendered. It injects nothing else: the workspace, Brain client, repository,
// durable snapshots, mutation decisions and completion state all stay real.
//
// Capturing matters as much as answering. The installed proof has to show that the
// operator was shown the exact scope before approving it, and a UI that only
// returned 'approve' would prove the plumbing while saying nothing about what the
// person actually saw.

import type {
  CancellationAnswer,
  CodingErrorViewModel,
  CodingFinalReportViewModel,
  CodingProgressViewModel,
  GovernedCodingUi,
  ScopeApprovalAnswer,
  ScopeApprovalViewModel,
} from '../../services/governedCodingUi.js';

export interface ScriptedCodingUi extends GovernedCodingUi {
  readonly approvals: ScopeApprovalViewModel[];
  readonly progress: CodingProgressViewModel[];
  readonly reports: CodingFinalReportViewModel[];
  readonly errors: CodingErrorViewModel[];
  readonly cancellationPrompts: number;
}

export interface ScriptedUiOptions {
  issueText?: string | undefined;
  /** Answer per approval round, so a superseded proposal can be answered anew. */
  approvals: ScopeApprovalAnswer[];
  cancellation?: CancellationAnswer;
  /** Force an adapter failure, to prove it becomes an explicit command failure. */
  failOn?: keyof GovernedCodingUi;
}

export function createScriptedCodingUi(options: ScriptedUiOptions): ScriptedCodingUi {
  const approvals: ScopeApprovalViewModel[] = [];
  const progress: CodingProgressViewModel[] = [];
  const reports: CodingFinalReportViewModel[] = [];
  const errors: CodingErrorViewModel[] = [];
  let approvalIndex = 0;
  let cancellationPrompts = 0;

  const failIf = (name: keyof GovernedCodingUi): void => {
    if (options.failOn === name) throw new Error(`scripted UI failure in ${name}`);
  };

  return {
    get approvals() { return approvals; },
    get progress() { return progress; },
    get reports() { return reports; },
    get errors() { return errors; },
    get cancellationPrompts() { return cancellationPrompts; },

    async requestIssueText(): Promise<string | undefined> {
      failIf('requestIssueText');
      return options.issueText;
    },
    async presentScopeApproval(model: ScopeApprovalViewModel): Promise<ScopeApprovalAnswer> {
      failIf('presentScopeApproval');
      approvals.push(model);
      // Past the scripted answers, dismiss — an unanswered proposal is never
      // silently approved.
      return options.approvals[approvalIndex++] ?? 'dismiss';
    },
    async presentCancellationChoice(): Promise<CancellationAnswer> {
      failIf('presentCancellationChoice');
      cancellationPrompts += 1;
      return options.cancellation ?? 'stop-watching';
    },
    async showProgress(model: CodingProgressViewModel): Promise<void> {
      failIf('showProgress');
      progress.push(model);
    },
    async showFinalReport(model: CodingFinalReportViewModel): Promise<void> {
      failIf('showFinalReport');
      reports.push(model);
    },
    async showError(model: CodingErrorViewModel): Promise<void> {
      failIf('showError');
      errors.push(model);
    },
  };
}
