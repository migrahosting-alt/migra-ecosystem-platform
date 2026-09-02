// Local brain-service lifecycle (P5, plan §9). Applies to the LOCAL backend
// only — pilot-api is a managed remote/on-host service and is NEVER auto-started
// or killed by the extension.
//
// Responsibilities: probe the configured brain port; adopt an already-running
// brain; refuse to adopt a foreign occupant (conflict); auto-start the local
// brain with a bounded readiness wait + backoff; track ONLY the process the
// extension itself spawned; shut that process down gracefully.
//
// vscode-free with injected launcher so the full matrix is unit-testable without
// real processes.

export type ProbeResult = 'brain' | 'foreign' | 'down';

export interface SpawnedProcess {
  readonly pid?: number;
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
  onExit(cb: () => void): void;
}

export interface BrainLauncher {
  spawn(command: readonly string[], environment?: Readonly<Record<string, string>>): SpawnedProcess;
  /** GET <url>/health → 'brain' (service===migrapilot-brain) | 'foreign' | 'down'. */
  probe(url: string, signal?: AbortSignal): Promise<ProbeResult>;
  sleep(ms: number): Promise<void>;
}

export type EnsureResult =
  | 'already-brain' // a brain was already listening — adopted, not owned
  | 'started' // we spawned it and it became ready
  | 'conflict' // port held by a non-brain service — refused to adopt/spawn
  | 'unable' // auto-start couldn't make it ready (no command / timeout)
  | 'disabled' // auto-start turned off and nothing was listening
  | 'remote'; // the brain URL is not local — we must never spawn a second brain for it

export interface EnsureOptions {
  url: string;
  autoStart: boolean;
  /** argv to launch the brain; empty means we cannot spawn one. */
  command: readonly string[];
  /** Private values inherited only by the child process. Never logged. */
  environment?: Readonly<Record<string, string>>;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Is this URL a brain we may legitimately start ourselves?
 *
 * Only loopback. A hostname that merely CONTAINS "localhost" (say
 * `localhost.evil.example`) is not loopback, so this parses rather than
 * substring-matches. An unparseable URL is treated as remote — the safe answer,
 * since the cost of guessing wrong is a second brain on unknown persistence.
 */
export function isLocalBrainUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

export class BrainLifecycle {
  private owned: SpawnedProcess | undefined;

  constructor(
    private readonly launcher: BrainLauncher,
    private readonly log: (message: string) => void,
  ) {}

  /** The PID of the brain the extension itself started (undefined if adopted or
   * not running). Only this process is ever killed on shutdown. */
  ownedPid(): number | undefined {
    return this.owned?.pid;
  }

  async ensureRunning(opts: EnsureOptions): Promise<EnsureResult> {
    const initial = await this.launcher.probe(opts.url);
    if (initial === 'brain') {
      return 'already-brain';
    }
    if (initial === 'foreign') {
      this.log(`brain port ${opts.url} is held by a non-brain service; refusing to adopt or start`);
      return 'conflict';
    }

    /*
     * NEVER SPAWN A SECOND BRAIN FOR A REMOTE URL.
     *
     * autoStart exists for the local development brain on loopback. Once the
     * extension points at the governed Brain over the tailnet, an unreachable
     * endpoint means the network or the service is down — it does NOT mean
     * "start your own". Spawning here would boot a second Brain against
     * different persistence, which is the exact fallback this lane exists to
     * remove: the product would look healthy while answering from an ungoverned
     * store. Fail closed and report the endpoint as down instead.
     */
    if (!isLocalBrainUrl(opts.url)) {
      this.log(`brain URL ${opts.url} is remote — not starting a local brain; the governed endpoint is unreachable`);
      return 'remote';
    }

    // Nothing listening.
    if (!opts.autoStart) {
      return 'disabled';
    }
    if (opts.command.length === 0) {
      this.log('autoStartBrain is on but migrapilot.brainAutoStartCommand is empty — cannot start');
      return 'unable';
    }

    const proc = this.launcher.spawn(opts.command, opts.environment);
    this.owned = proc;
    proc.onExit(() => {
      if (this.owned === proc) {
        this.owned = undefined;
      }
    });

    const maxAttempts = opts.maxAttempts ?? 20;
    const base = opts.baseDelayMs ?? 100;
    const cap = opts.maxDelayMs ?? 1000;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.launcher.sleep(Math.min(base * 2 ** attempt, cap));
      const state = await this.launcher.probe(opts.url);
      if (state === 'brain') {
        this.log(`local brain started (pid ${proc.pid ?? '?'})`);
        return 'started';
      }
      if (state === 'foreign') {
        // A different service grabbed the port while we were starting.
        this.log('brain port was taken by a foreign service during startup');
        await this.shutdown();
        return 'conflict';
      }
    }

    this.log('local brain did not become ready in time');
    await this.shutdown(); // clean up the process we spawned
    return 'unable';
  }

  /** Gracefully stop ONLY the extension-owned brain process (SIGTERM, then
   * SIGKILL after a grace period). Adopted brains are never killed. */
  async shutdown(graceMs = 200): Promise<void> {
    const proc = this.owned;
    if (!proc) {
      return;
    }
    this.owned = undefined;
    proc.kill('SIGTERM');
    await this.launcher.sleep(graceMs);
    proc.kill('SIGKILL');
  }
}
