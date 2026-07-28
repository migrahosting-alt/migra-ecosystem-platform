/**
 * Control identity for `MigraPilot: Diagnose Failure`.
 *
 * Co-located with the command it describes, per the registry decision: a central list drifts
 * from reality, and drift in the registry is worse than drift anywhere else because
 * everything downstream trusts it. The build-time aggregator collects these declarations
 * into a generated artifact — DERIVED EVIDENCE, never the source of truth.
 */

import type { ControlDeclaration } from '../interaction/types.js';

export const diagnoseFailureControl: ControlDeclaration = {
  applicationId: 'migrapilot-vscode',
  surfaceId: 'engineer.command-palette',
  controlId: 'diagnose-failure',
  // v1. Bump only when what this control DOES changes — never for a label or an icon.
  controlVersion: 1,
  instanceScope: 'workspace',
  // It reads diagnostics and renders a document. It cannot apply an edit, and the Brain
  // additionally withholds mutation tools for `repository-diagnosis` authority.
  consequence: 'read-only',
  locator: {
    adapter: 'vscode-command',
    commandId: 'migrapilot.diagnoseFailure',
    confidence: 'exact',
  },
};
