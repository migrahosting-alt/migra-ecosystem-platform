/**
 * Control identity for `MigraPilot: Run Command` — the ad-hoc command lane.
 *
 * `consequence: 'mutating'` is the honest answer, and it is worth stating why rather than
 * copying Diagnose Failure's `read-only`. This control does not itself write anything: it
 * sends one argv array to the Brain and renders what came back. But the COMMAND it runs is
 * allowed to write — `npm test` drops coverage output, `tsc` emits build artefacts — and a
 * control's consequence describes what its invocation can cause, not what its own code
 * touches. Declaring `read-only` here would be true of the file and false of the effect.
 *
 * It is NOT `approval`: this lane adds no approval ceremony. The executor's own policy
 * already decides what may run (allowlist, no shell, containment, publish/deploy/push
 * refusal), and adding a second gate on top of a policy-approved command would be
 * ceremony without safety — the very cost this lane exists to avoid. Agent Mode remains
 * the path with checkpoint/approval semantics.
 */

import type { ControlDeclaration } from '../interaction/types.js';

export const runCommandControl: ControlDeclaration = {
  applicationId: 'migrapilot-vscode',
  surfaceId: 'engineer.command-palette',
  controlId: 'run-command',
  controlVersion: 1,
  // The command runs at the resolved workspace root and the Brain contains it there.
  instanceScope: 'workspace',
  consequence: 'mutating',
  locator: {
    adapter: 'vscode-command',
    // Confirmed against package.json contributes.commands.
    commandId: 'migrapilot.runCommand',
    confidence: 'exact',
  },
};
