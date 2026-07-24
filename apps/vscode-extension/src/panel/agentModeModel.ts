import type { AgentModeCommandPreview, AgentModeCommandRunView, AgentModeRecoveryClass, AgentModeRunHistoryDetail, AgentModeRunHistorySummary, AgentModeRunRecoveryStatus, AgentModeState } from '@migrapilot/protocol';

export class AgentModeSessionGate {
  private value = false;
  get enabled(): boolean { return this.value; }
  enter(): void { this.value = true; }
  reset(): void { this.value = false; }
}

export function agentModeStatusText(enabled: boolean, state: AgentModeState): string {
  return enabled ? `$(shield) Agent Mode: ${state}` : '$(shield) Agent Mode: OFF';
}

export function renderPreviewLines(preview: AgentModeCommandPreview): string[] {
  return [
    `Recipe: ${preview.recipe}`,
    `Policy: ${preview.policyVersion}`,
    `Execution identity: ${preview.executionIdentity}`,
    `Environment policy: ${preview.environmentPolicy}`,
    `Workspace material: ${preview.workspaceMaterialFingerprint}`,
    `Snapshot: ${preview.snapshotId}`,
    `Live source: ${preview.sourceWorkspace}`,
    `Executable: ${preview.executable}`,
    ...preview.arguments.map((arg, index) => `Arg ${index + 1}: ${arg}`),
    `Working directory: ${preview.cwd}`,
    `Timeout: ${preview.timeoutMs} ms`,
    `Output limit: ${preview.outputLimitBytes} bytes`,
    `Mutation: ${preview.mutationClassification}`,
    `Network: ${preview.networkPolicy}`,
    `Can modify files: ${preview.canModifyFiles ? 'yes' : 'no'}`,
    `Reason: ${preview.reason}`,
    `Request: ${preview.requestId}`,
    `Fingerprint: ${preview.fingerprint}`,
    `Expires: ${new Date(preview.expiresAt).toISOString()}`,
    ...preview.expectedEffects.map((effect) => `Expected effect: ${effect}`),
    ...preview.environment.map((entry) => `Environment ${entry.key}: ${entry.value}`),
    ...preview.warnings.map((warning) => `Warning: ${warning}`),
  ];
}

export function agentModeControlState(state: AgentModeState): { approve: boolean; reject: boolean; cancel: boolean; reconcile: boolean; resume: false; freshProposal: boolean; restartLabel?: string } {
  const interrupted = state === 'STALE' || state === 'FAILED' || state === 'EXPIRED';
  return {
    approve: state === 'AWAITING_APPROVAL',
    reject: state === 'AWAITING_APPROVAL',
    cancel: state === 'PLANNING' || state === 'AWAITING_APPROVAL' || state === 'APPROVED' || state === 'EXECUTING',
    reconcile: true,
    resume: false,
    freshProposal: interrupted,
    ...(interrupted ? { restartLabel: 'Interrupted or stale Agent run — create a new proposal to continue.' } : {}),
  };
}

export function agentModeRecoveryStatusText(status: AgentModeRunRecoveryStatus): string {
  const label = recoveryClassLabel(status.recoveryClass);
  const action = status.eligible ? 'Fresh proposal available.' : status.recommendedAction;
  return `${label}: ${status.explanation} ${action}`;
}

export function agentModeRecoveryControlState(
  view: AgentModeCommandRunView,
  status?: AgentModeRunRecoveryStatus,
): { freshProposal: boolean; resume: false; label?: string } {
  const eligible = status?.eligible ?? view.recovery?.eligible ?? false;
  const label = status ? agentModeRecoveryStatusText(status) : view.recovery?.reason;
  return { freshProposal: eligible, resume: false, ...(label ? { label } : {}) };
}

export function agentModeHistorySummaryLines(run: AgentModeRunHistorySummary): string[] {
  return [
    `${new Date(run.updatedAt).toISOString()} · ${run.state} · ${run.recipe}`,
    `Run: ${run.runId}`,
    `Request: ${run.requestId}`,
    `Approval: ${run.approvalLifecycle}`,
    `Recovery: ${run.recoveryClass}${run.recoveryEligible ? ' (fresh proposal allowed)' : ''}`,
    `Integrity: ${run.integrity}${run.integrityIssues.length ? ` — ${run.integrityIssues.join('; ')}` : ''}`,
  ];
}

export function agentModeHistoryDetailLines(detail: AgentModeRunHistoryDetail): string[] {
  const { summary } = detail;
  const lines = [
    ...agentModeHistorySummaryLines(summary),
    `Events: ${detail.timeline.length}`,
    `Retention: ${detail.retention.reason}`,
  ];
  if (detail.lineage.sourceRunId) lines.push(`Source run: ${detail.lineage.sourceRunId}`);
  if (detail.lineage.successorRunId) lines.push(`Successor run: ${detail.lineage.successorRunId}`);
  if (detail.recovery) lines.push(`Recovery recommendation: ${detail.recovery.recommendedAction}`);
  if (detail.preview) lines.push(`Snapshot: ${detail.preview.snapshotId}`, `Fingerprint: ${detail.preview.fingerprint}`);
  if (detail.result) lines.push(`Exit code: ${detail.result.exitCode}`, `Result redacted: ${detail.result.redacted ? 'yes' : 'no'}`);
  if (detail.error) lines.push(`Failure: ${detail.error.code}`);
  return lines;
}

function recoveryClassLabel(value: AgentModeRecoveryClass): string {
  switch (value) {
    case 'REPROPOSAL_REQUIRED': return 'Fresh proposal required';
    case 'REPROPOSAL_ALLOWED': return 'Fresh proposal allowed';
    case 'SNAPSHOT_CHANGED': return 'Snapshot changed';
    case 'RECIPE_DISABLED': return 'Recipe disabled';
    case 'WORKSPACE_MISMATCH': return 'Workspace mismatch';
    case 'POLICY_CHANGED': return 'Policy changed';
    case 'AUTHORIZATION_LOST': return 'Authorization lost';
    case 'INTERRUPTED_EXECUTION': return 'Interrupted execution';
    case 'RETENTION_REMOVED': return 'Retention removed';
    case 'SCHEMA_INCOMPATIBLE': return 'Schema incompatible';
    case 'TERMINAL_NO_RECOVERY': return 'No recovery';
    case 'NONE': return 'No recovery action';
  }
}
