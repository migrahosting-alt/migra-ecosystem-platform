/**
 * Control identity for `MigraPilot: Governed Coding Change`.
 *
 * Co-located with the command, per the registry decision. The interesting field is
 * `consequence`: this is the first MigraPilot control that can cause a WRITE to the
 * user's repository, and it must be declared `mutating`. It is gated by a scope
 * approval the operator gives once against an exact, hashed path set — but the
 * gate is what makes the write safe, not what makes it read-only, and a
 * declaration that hid the write behind its approval would misreport the risk to
 * everything downstream that trusts this registry.
 */

import type { ControlDeclaration } from '../interaction/types.js';

export const governedCodingControl: ControlDeclaration = {
  applicationId: 'migrapilot-vscode',
  surfaceId: 'engineer.command-palette',
  controlId: 'governed-coding',
  controlVersion: 1,
  instanceScope: 'workspace',
  consequence: 'mutating',
  locator: {
    adapter: 'vscode-command',
    commandId: 'migrapilot.governedCoding',
    confidence: 'exact',
  },
};
