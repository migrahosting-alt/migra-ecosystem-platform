import * as vscode from 'vscode';

import type { BrainConfig } from './brainClient.js';

/**
 * Production BrainConfig backed by VS Code settings.
 *
 * Kept in its own module so `brainClient.ts` stays free of a hard `vscode` import and
 * remains constructible under bare `node --test` — the public-path behaviour tests
 * have to drive the exported methods, not the transport primitive.
 */
export function vscodeBrainConfig(): BrainConfig {
  const cfg = () => vscode.workspace.getConfiguration('migrapilot');
  return {
    baseUrl: () => String(cfg().get('brainUrl', 'http://127.0.0.1:3988')),
    timeoutMs: () => Number(cfg().get('brainTimeoutMs', 30_000)),
    connectionTimeoutMs: () => Number(cfg().get('brainConnectionTimeoutMs', 5_000)),
  };
}
