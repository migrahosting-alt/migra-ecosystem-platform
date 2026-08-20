/**
 * Control identity for `MigraPilot: Run Tests`.
 *
 * `consequence: 'mutating'` for the same reason the ad-hoc command lane is: the control
 * writes nothing itself, but the suite it runs legitimately can — a test run drops coverage
 * output, build artefacts and snapshots — and consequence describes the EFFECT of invoking
 * the control, not what its own file touches. Declaring `read-only` would be true of this
 * module and false of what happens when you press it.
 */

import type { ControlDeclaration } from '../interaction/types.js';

export const runTestsControl: ControlDeclaration = {
  applicationId: 'migrapilot-vscode',
  surfaceId: 'engineer.command-palette',
  controlId: 'run-tests',
  controlVersion: 1,
  instanceScope: 'workspace',
  consequence: 'mutating',
  locator: {
    adapter: 'vscode-command',
    commandId: 'migrapilot.runTests',
    confidence: 'exact',
  },
};
