import { readFileSync } from 'node:fs';

import * as vscode from 'vscode';

import {
  CapabilityContractUnavailableError,
  loadCapabilityContract,
  resolveCapability,
  type CapabilityContractReader,
  type CapabilityRequirements,
} from './capabilityResolver.js';

/**
 * Production contract reader backed by VS Code settings.
 *
 * Kept in its own module so `capabilityResolver.ts` stays free of a hard `vscode` import and
 * remains testable under bare `node --test` — the same reason `brainConfigVscode.ts` exists.
 *
 * The path points at the contract MigraAI-Brain PUBLISHED. It must never be pointed at
 * MigraAI-Engineer: Engineer is a build-time component and is absent at runtime by design.
 */
export function vscodeCapabilityContractReader(): CapabilityContractReader {
  const configured = (): string =>
    String(vscode.workspace.getConfiguration('migrapilot').get('capabilityContractPath', '')).trim();
  return {
    read: () => {
      const path = configured();
      if (path.length === 0) return undefined;
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return undefined;
      }
    },
    describe: () => {
      const path = configured();
      return path.length === 0 ? '<migrapilot.capabilityContractPath not set>' : path;
    },
  };
}

/**
 * One line describing qualified-intelligence availability, for the health surface.
 *
 * NAMING: this reports **MigraAI Brain** (the ecosystem capability layer that publishes the
 * contract), NOT the **MigraPilot Brain Service** (`apps/brain-service`, the local inference
 * runtime on :3988). Both are colloquially "the Brain" and fail in opposite ways — see
 * MigraAI-Engineer/docs/architecture/component-naming.md. Reporting one as the other sends
 * an operator to the wrong component.
 *
 * Reports the three states a caller must be able to distinguish:
 *   - contract unavailable  (Brain has published nothing, or the path is wrong)
 *   - contract present, nothing qualified
 *   - contract present, N qualified capabilities
 */
export function capabilityStatusLine(reader: CapabilityContractReader = vscodeCapabilityContractReader()): string {
  try {
    const contract = loadCapabilityContract(reader);
    if (contract.capabilities.length === 0) {
      return 'MigraAI Brain: contract present, but NO capability is qualified. MigraPilot will not substitute a model.';
    }
    const summary = contract.capabilities
      .map((handle) => `${handle.capabilityId} (${handle.stage})`)
      .join(', ');
    return `MigraAI Brain: ${contract.capabilities.length} qualified capability(ies) — ${summary}.`;
  } catch (error) {
    if (error instanceof CapabilityContractUnavailableError) {
      return `MigraAI Brain: capability contract UNAVAILABLE — ${error.message}`;
    }
    throw error;
  }
}

/**
 * Resolve a capability for a command. Throws when nothing qualified satisfies the
 * requirements: a command must not proceed with unqualified intelligence.
 */
export function resolveForCommand(requirements: CapabilityRequirements, reader: CapabilityContractReader = vscodeCapabilityContractReader()) {
  return resolveCapability(loadCapabilityContract(reader), requirements);
}
