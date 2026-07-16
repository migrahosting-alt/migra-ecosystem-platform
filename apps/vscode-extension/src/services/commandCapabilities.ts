// Per-command capability requirements + gating (see
// docs/pilot-api-integration-plan.md §3, P3). Each command declares the pilot-api
// operation classes it needs; the gate is evaluated against the ALREADY-resolved
// backend BEFORE any remote request or workspace mutation. It never re-resolves
// or re-routes (auto stays on the backend chosen at resolution).
//
// vscode-free so it is unit-testable.

import { type ResolvedBackend } from './backendRouter.js';
import { PilotError } from '@migrapilot/pilot-client';

export interface CommandCapabilityRequirement {
  command: string;
  /** Coarse pilot-api operation classes this command needs in remote mode. */
  operationClasses: string[];
  /** Requires SSE streaming support (chat-style commands). */
  needsStreaming?: boolean;
}

export const CAP_EXPLAIN_SELECTION: CommandCapabilityRequirement = {
  command: 'explainSelection',
  operationClasses: ['chat'],
  needsStreaming: true,
};

export const CAP_FIX_DIAGNOSTICS: CommandCapabilityRequirement = {
  command: 'fixDiagnostics',
  operationClasses: ['proposed-edits'],
};

export const CAP_PROPOSED_EDITS: CommandCapabilityRequirement = {
  command: 'proposedEdits',
  operationClasses: ['proposed-edits'],
};

export const CAP_DIAGNOSTICS_SYNC: CommandCapabilityRequirement = {
  command: 'diagnosticsSync',
  operationClasses: ['workspace.read'],
};

export const CAP_APPROVALS: CommandCapabilityRequirement = {
  command: 'approvals',
  operationClasses: ['approvals'],
};

export const CAP_GENERATE_TESTS: CommandCapabilityRequirement = {
  command: 'generateTests',
  operationClasses: ['test-generation'],
};

export const CAP_COMMIT_MESSAGE: CommandCapabilityRequirement = {
  command: 'commitMessage',
  operationClasses: ['commit-message'],
};

export type CapabilityDecision =
  | { mode: 'local' }
  | { mode: 'remote' }
  | { mode: 'denied'; error: PilotError };

/**
 * Decide how a command should run against the resolved backend.
 *  - local backend → run the existing local implementation (default path);
 *  - remote backend with all required capabilities → run the remote path;
 *  - remote backend missing a capability, or remote-unavailable → denied with a
 *    structured PilotError (surfaced to the user; NEVER a local fallback).
 */
export function evaluateCapability(
  backend: ResolvedBackend,
  req: CommandCapabilityRequirement,
): CapabilityDecision {
  if (backend.kind === 'local') {
    return { mode: 'local' };
  }
  if (backend.kind === 'remote-unavailable') {
    return { mode: 'denied', error: backend.error };
  }

  const caps = backend.caps;
  const missing = req.operationClasses.filter((c) => !caps.operationClasses.includes(c));
  if (missing.length > 0) {
    return {
      mode: 'denied',
      error: new PilotError(
        'CAPABILITY_MISSING',
        `pilot-api does not support ${req.command} (missing operation classes: ${missing.join(', ')})`,
      ),
    };
  }
  if (req.needsStreaming && !caps.streaming) {
    return {
      mode: 'denied',
      error: new PilotError(
        'CAPABILITY_MISSING',
        `pilot-api does not support streaming required by ${req.command}`,
      ),
    };
  }
  return { mode: 'remote' };
}
