import type { AgentModeCommandPreview, AgentModeState } from '@migrapilot/protocol';

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
