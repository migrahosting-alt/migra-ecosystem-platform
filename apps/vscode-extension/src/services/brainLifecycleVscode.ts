import { spawn } from 'node:child_process';
import { type BrainLauncher, type ProbeResult, type SpawnedProcess } from './brainLifecycle.js';

// Real BrainLauncher backing the lifecycle for the local brain-service. Kept out
// of brainLifecycle.ts so the lifecycle logic stays vscode/node-process free and
// fully unit-testable. This adapter uses node:child_process + fetch.

export function createRealBrainLauncher(): BrainLauncher {
  return {
    spawn(command: readonly string[]): SpawnedProcess {
      const [cmd, ...args] = command;
      const child = spawn(cmd!, args, { stdio: 'ignore', detached: false });
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
      try {
        const res = await fetch(target, { signal: signal ?? AbortSignal.timeout(1500) });
        if (!res.ok) {
          return 'down';
        }
        const body = (await res.json().catch(() => null)) as { service?: unknown } | null;
        return body?.service === 'migrapilot-brain' ? 'brain' : 'foreign';
      } catch {
        return 'down';
      }
    },

    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
}
