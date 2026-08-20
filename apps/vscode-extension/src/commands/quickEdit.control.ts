/**
 * Control identity for `MigraPilot: Quick Edit` — the lightweight edit lane.
 *
 * `consequence: 'mutating'` rather than `'approval'`, and the distinction is worth stating.
 * The control DOES pass through an approval: `fs.applyChangeset` is `approvalRequired` on
 * the engine and the mint -> consume handshake is honoured unchanged. But `approval` in this
 * vocabulary describes a control whose own job is to grant or withhold authority — the
 * pending-actions reviewer. This one's job is to change files; the approval is a property of
 * the path it uses, not of the control. Declaring `approval` here would misfile an editing
 * action as a governance action.
 *
 * It shares `mutating` with `governed-coding`, which is correct: both cause repository
 * writes. They differ in SCOPE, not in kind — this lane is bounded to a few files and a
 * small byte budget, and refuses anything larger rather than quietly growing into a
 * governed run.
 */

import type { ControlDeclaration } from '../interaction/types.js';

export const quickEditControl: ControlDeclaration = {
  applicationId: 'migrapilot-vscode',
  surfaceId: 'engineer.command-palette',
  controlId: 'quick-edit',
  controlVersion: 1,
  // Bounded to the resolved workspace; the engine contains every path within it.
  instanceScope: 'workspace',
  consequence: 'mutating',
  locator: {
    adapter: 'vscode-command',
    // Confirmed against package.json contributes.commands.
    commandId: 'migrapilot.quickEdit',
    confidence: 'exact',
  },
};
