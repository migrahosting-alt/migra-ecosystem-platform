/**
 * Control identity for `MigraPilot: Git Status & History`.
 *
 * `consequence: 'read-only'` — and unlike the quick-edit lane, that is true of both the
 * control AND its effect. It asks the Brain three fixed questions (overview, bounded
 * history, blame) and renders the answers; no request it can make carries a git subcommand
 * or flag, so there is no input that turns it into a write.
 *
 * It shares `read-only` with `diagnose-failure` for the same reason: reading the repository
 * to inform a person changes nothing in it.
 */

import type { ControlDeclaration } from '../interaction/types.js';

export const gitOverviewControl: ControlDeclaration = {
  applicationId: 'migrapilot-vscode',
  surfaceId: 'engineer.command-palette',
  controlId: 'git-overview',
  controlVersion: 1,
  // Scoped to the resolved workspace; the Brain contains every path within it.
  instanceScope: 'workspace',
  consequence: 'read-only',
  locator: {
    adapter: 'vscode-command',
    // Confirmed against package.json contributes.commands.
    commandId: 'migrapilot.gitOverview',
    confidence: 'exact',
  },
};
