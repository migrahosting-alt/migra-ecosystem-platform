import { spawn } from 'node:child_process';
import * as vscode from 'vscode';

import { type BrainLauncher, type ProbeResult, type SpawnedProcess } from './brainLifecycle.js';
import { runBrainOperation } from './brainTransport.js';

// Real BrainLauncher backing the lifecycle for the local brain-service. Kept out
// of brainLifecycle.ts so the lifecycle logic stays vscode/node-process free and
// fully unit-testable. This adapter uses node:child_process + fetch.

export function createRealBrainLauncher(): BrainLauncher {
  return {
    spawn(command: readonly string[], environment?: Readonly<Record<string, string>>): SpawnedProcess {
      const [cmd, ...args] = command;
      const child = spawn(cmd!, args, { stdio: 'ignore', detached: false, env: { ...process.env, ...(environment ?? {}) } });
      return {
        pid: child.pid,
        kill: (signal) => {
          try {
            child.kill(signal);
          } catch {
            /* already gone */
          }
        },
        onExit: (cb) => {
          child.on('exit', cb);
        },
      };
    },

    async probe(url: string, signal?: AbortSignal): Promise<ProbeResult> {
      const target = `${url.replace(/\/+$/, '')}/health`;
      // Governed probe. The former hard-coded 1500ms timeout is gone: the budget now
      // comes from `migrapilot.brainConnectionTimeoutMs`, so probe and client agree.
      //
      // This is a LIFECYCLE probe — it answers "whose process holds this port", not
      // "is the Brain ready". It therefore writes no operation state and no connection
      // record; BrainConnectionState alone owns readiness.
      const timeoutMs = Number(
        vscode.workspace.getConfiguration('migrapilot').get('brainConnectionTimeoutMs', 5_000),
      );
      const outcome = await runBrainOperation<{ service?: unknown }>({
        operationId: `lifecycle-probe-${Date.now().toString(36)}`,
        requestedAction: 'lifecycle:probe',
        endpoint: target,
        method: 'GET',
        timeoutMs,
        ...(signal ? { externalSignal: signal } : {}),
      });
      // Anything short of an observed, parsed terminal response means nothing usable
      // is listening. Never infer 'foreign' from a failure.
      if (!outcome.ok || !outcome.value) return 'down';
      return outcome.value.service === 'migrapilot-brain' ? 'brain' : 'foreign';
    },

    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
}
