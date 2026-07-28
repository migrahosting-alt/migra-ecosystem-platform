/**
 * Control identity for `MigraPilot: Explain Selection`.
 *
 * The second declared control, and the one that tests whether the identity model generalises
 * rather than merely fitting the case it was designed against.
 *
 * It differs from Diagnose Failure in the ways that matter: its preconditions are an active
 * editor AND a non-empty selection rather than a diagnostic, its surface is the editor
 * context rather than the palette, and its evidence comes from the selection rather than from
 * the diagnostics collection. Same adapter, same locator kind, different interaction context.
 */

import type { ControlDeclaration } from '../interaction/types.js';

export const explainSelectionControl: ControlDeclaration = {
  applicationId: 'migrapilot-vscode',
  // A different surface from the palette control: both are reachable from the palette, but
  // this one's meaningful context is an editor selection, and the surface names where the
  // action belongs rather than where it can be typed.
  surfaceId: 'editor.selection.context',
  controlId: 'explain-selection',
  controlVersion: 1,
  // Its effect is bounded by the document being read, not by the workspace.
  instanceScope: 'document',
  consequence: 'read-only',
  locator: {
    adapter: 'vscode-command',
    // Confirmed against package.json contributes.commands, not assumed from the title.
    commandId: 'migrapilot.explainSelection',
    confidence: 'exact',
  },
};
