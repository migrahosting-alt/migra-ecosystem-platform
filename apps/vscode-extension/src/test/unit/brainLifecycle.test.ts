import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BrainLifecycle,
  type BrainLauncher,
  type EnsureOptions,
  type ProbeResult,
  type SpawnedProcess,
} from '../../services/brainLifecycle.js';

class FakeProcess implements SpawnedProcess {
  readonly pid = 4242;
  readonly signals: string[] = [];
  private exitCbs: Array<() => void> = [];
  kill(signal: 'SIGTERM' | 'SIGKILL'): void {
    this.signals.push(signal);
  }
  onExit(cb: () => void): void {
    this.exitCbs.push(cb);
  }
  triggerExit(): void {
    for (const cb of this.exitCbs) cb();
  }
}

class FakeLauncher implements BrainLauncher {
  spawned: string[][] = [];
  environments: Array<Readonly<Record<string, string>> | undefined> = [];
  lastProcess: FakeProcess | undefined;
  private probes: ProbeResult[];
  private fallback: ProbeResult;

  constructor(probes: ProbeResult[], fallback: ProbeResult = 'down') {
    this.probes = [...probes];
    this.fallback = fallback;
  }
  spawn(command: readonly string[], environment?: Readonly<Record<string, string>>): SpawnedProcess {
    this.spawned.push([...command]);
    this.environments.push(environment);
    this.lastProcess = new FakeProcess();
    return this.lastProcess;
  }
  async probe(): Promise<ProbeResult> {
    return this.probes.length ? this.probes.shift()! : this.fallback;
  }
  async sleep(): Promise<void> {
    /* no real delay */
  }
}

const OPTS: EnsureOptions = {
  url: 'http://127.0.0.1:3988',
  autoStart: true,
  command: ['node', 'server.js'],
  maxAttempts: 5,
  baseDelayMs: 1,
  maxDelayMs: 1,
};

function lifecycle(launcher: BrainLauncher): BrainLifecycle {
  return new BrainLifecycle(launcher, () => {});
}

test('adopts an already-running brain without spawning', async () => {
  const l = new FakeLauncher(['brain']);
  const lc = lifecycle(l);
  assert.equal(await lc.ensureRunning(OPTS), 'already-brain');
  assert.equal(l.spawned.length, 0);
  assert.equal(lc.ownedPid(), undefined, 'adopted brain is not owned');
});

test('refuses to adopt a foreign occupant (conflict), no spawn', async () => {
  const l = new FakeLauncher(['foreign']);
  const lc = lifecycle(l);
  assert.equal(await lc.ensureRunning(OPTS), 'conflict');
  assert.equal(l.spawned.length, 0);
});

test('disabled: nothing listening and autoStart off', async () => {
  const l = new FakeLauncher(['down']);
  const lc = lifecycle(l);
  assert.equal(await lc.ensureRunning({ ...OPTS, autoStart: false }), 'disabled');
  assert.equal(l.spawned.length, 0);
});

test('unable: autoStart on but no command', async () => {
  const l = new FakeLauncher(['down']);
  const lc = lifecycle(l);
  assert.equal(await lc.ensureRunning({ ...OPTS, command: [] }), 'unable');
  assert.equal(l.spawned.length, 0);
});

test('started: spawns and waits until ready, tracks owned pid', async () => {
  // initial down → spawn → down, down, brain
  const l = new FakeLauncher(['down', 'down', 'down', 'brain']);
  const lc = lifecycle(l);
  assert.equal(await lc.ensureRunning(OPTS), 'started');
  assert.equal(l.spawned.length, 1);
  assert.equal(lc.ownedPid(), 4242);
});

test('one-time bootstrap environment is forwarded only to the launched brain', async () => {
  const l = new FakeLauncher(['down', 'brain']);
  const lc = lifecycle(l);
  const environment = { MIGRAPILOT_AGENT_BOOTSTRAP_SECRET: 'private-bootstrap-value', MIGRAPILOT_AGENT_EXTENSION_PID: '4242' };
  assert.equal(await lc.ensureRunning({ ...OPTS, environment }), 'started');
  assert.deepEqual(l.environments, [environment]);
});

test('readiness timeout → unable, and the spawned process is cleaned up', async () => {
  const l = new FakeLauncher(['down'], 'down'); // never becomes brain
  const lc = lifecycle(l);
  assert.equal(await lc.ensureRunning({ ...OPTS, maxAttempts: 3 }), 'unable');
  assert.equal(l.spawned.length, 1);
  assert.deepEqual(l.lastProcess?.signals, ['SIGTERM', 'SIGKILL'], 'spawned proc killed on timeout');
  assert.equal(lc.ownedPid(), undefined);
});

test('foreign service grabs the port during startup → conflict + cleanup', async () => {
  const l = new FakeLauncher(['down', 'foreign']);
  const lc = lifecycle(l);
  assert.equal(await lc.ensureRunning(OPTS), 'conflict');
  assert.deepEqual(l.lastProcess?.signals, ['SIGTERM', 'SIGKILL']);
});

test('shutdown gracefully SIGTERM→SIGKILL the owned process', async () => {
  const l = new FakeLauncher(['down', 'brain']);
  const lc = lifecycle(l);
  await lc.ensureRunning(OPTS);
  const proc = l.lastProcess!;
  await lc.shutdown();
  assert.deepEqual(proc.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(lc.ownedPid(), undefined);
});

test('shutdown does NOT kill an adopted (not-owned) brain', async () => {
  const l = new FakeLauncher(['brain']);
  const lc = lifecycle(l);
  await lc.ensureRunning(OPTS); // adopted
  await lc.shutdown();
  assert.equal(l.lastProcess, undefined, 'never spawned, nothing to kill');
});

test('owned pid clears if the process exits on its own', async () => {
  const l = new FakeLauncher(['down', 'brain']);
  const lc = lifecycle(l);
  await lc.ensureRunning(OPTS);
  assert.equal(lc.ownedPid(), 4242);
  l.lastProcess!.triggerExit();
  assert.equal(lc.ownedPid(), undefined);
});
