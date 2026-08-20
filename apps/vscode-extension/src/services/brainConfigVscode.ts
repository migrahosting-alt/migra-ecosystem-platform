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
    // Hard ceiling for ONE non-streaming request. The 30s default here was
    // undeclared in package.json, so no user could raise it — and it governs
    // Explain Code, Fix Problems, Write Tests and Write a Commit Message, none of
    // which a local model finishes in 30s. Declared now, with a real default.
    timeoutMs: () => Number(cfg().get('brainTimeoutMs', 600_000)),
    connectionTimeoutMs: () => Number(cfg().get('brainConnectionTimeoutMs', 5_000)),
  };
}
