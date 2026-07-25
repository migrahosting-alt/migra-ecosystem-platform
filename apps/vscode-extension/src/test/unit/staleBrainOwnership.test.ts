import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  TEST_BRAIN_OWNER_ENV,
  isBrainService,
  isTestOwnedBrain,
  killStaleBrains,
  markTestBrainOwnership,
  mayKillBrain,
} from '../../test/support/staleBrains.js';

/**
 * The stale-brain sweep once killed EVERY brain-service on port 3988 — which is
 * also the developer's default `migrapilot.brainUrl`. It therefore destroyed
 * brains the suite never launched.
 *
 * These tests pin the corrected contract with REAL processes:
 *   - a brain the suite launched (carries the ownership marker) is swept;
 *   - a pre-existing brain (no marker) SURVIVES;
 *   - ownership that cannot be proven fails CLOSED.
 */

const LINUX = process.platform === 'linux';

/** A stand-in brain: a real listening process whose argv contains
 * "brain-service", so `isBrainService` recognises it exactly as it would the
 * real service. It is a decoy only in that it serves no routes. */
function decoyBrainScript(): string {
  return [
    "const net = require('node:net');",
    'const port = Number(process.argv[2]);',
    'const server = net.createServer(() => {});',
    "server.listen(port, '127.0.0.1');",
    'setInterval(() => {}, 1 << 30);',
  ].join('\n');
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

function waitFor(check: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = (): void => {
      if (check()) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 50);
    };
    tick();
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface Decoy {
  child: ChildProcess;
  pid: number;
  port: number;
}

const cleanups: Array<() => void> = [];

async function startDecoy(root: string, owned: boolean): Promise<Decoy> {
  // A directory literally named `brain-service` so argv contains it.
  const dir = path.join(root, owned ? 'owned/brain-service' : 'foreign/brain-service');
  mkdirSync(dir, { recursive: true });
  const script = path.join(dir, 'server.js');
  writeFileSync(script, decoyBrainScript());
  const port = await freePort();

  const env = { ...process.env };
  // The FOREIGN brain must not carry the marker — it stands in for a developer's
  // brain started outside any test run.
  if (owned) env[TEST_BRAIN_OWNER_ENV] = 'test-owner-token';
  else delete env[TEST_BRAIN_OWNER_ENV];

  const child = spawn(process.execPath, [script, String(port)], { env, stdio: 'ignore' });
  cleanups.push(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  });
  const pid = child.pid!;
  // Wait until it is actually listening, or the sweep has nothing to find.
  await waitFor(() => {
    try {
      return require('node:child_process').execSync(`ss -ltn 2>/dev/null | grep -c ':${port} ' || true`, { encoding: 'utf8' }).trim() !== '0';
    } catch {
      return false;
    }
  });
  return { child, pid, port };
}

test('a brain the suite did NOT launch survives the sweep', { skip: !LINUX && 'ownership is proved via /proc (Linux only)' }, async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'migrapilot-brain-own-'));
  t.after(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    rmSync(root, { recursive: true, force: true });
  });

  const foreign = await startDecoy(root, false);
  const owned = await startDecoy(root, true);

  // Both look like a brain-service to the identity check…
  assert.equal(isBrainService(foreign.pid), true, 'the foreign decoy must be recognised as a brain');
  assert.equal(isBrainService(owned.pid), true, 'the owned decoy must be recognised as a brain');
  // …but only one is provably ours.
  assert.equal(isTestOwnedBrain(foreign.pid), false, 'a brain without the marker is not test-owned');
  assert.equal(isTestOwnedBrain(owned.pid), true, 'a brain with the marker is test-owned');
  assert.equal(mayKillBrain(foreign.pid), false, 'identity alone must never authorise a kill');
  assert.equal(mayKillBrain(owned.pid), true);

  const result = killStaleBrains([foreign.port, owned.port]);

  await waitFor(() => !alive(owned.pid));
  assert.equal(alive(owned.pid), false, 'the brain this run launched must be swept');
  assert.equal(
    alive(foreign.pid),
    true,
    'THE REGRESSION: a pre-existing brain the suite did not launch must still be running',
  );
  assert.ok(result.killed.includes(owned.pid), 'the sweep must report what it killed');
  assert.ok(result.spared.includes(foreign.pid), 'the sweep must report what it deliberately spared');
});

test('ownership fails CLOSED when it cannot be proven', () => {
  // A PID that cannot exist → /proc read fails → not owned, not killable.
  const impossible = 0x7fffffff;
  assert.equal(isTestOwnedBrain(impossible), false);
  assert.equal(mayKillBrain(impossible), false);
  // This very process is not a marked brain, so it is never sweepable.
  assert.equal(mayKillBrain(process.pid), false);
});

test('the ownership marker is stamped on the environment the run inherits', () => {
  const previous = process.env[TEST_BRAIN_OWNER_ENV];
  try {
    const token = markTestBrainOwnership('token-under-test');
    assert.equal(token, 'token-under-test');
    // Children inherit process.env, which is how the extension-spawned brain —
    // launched by the extension under test, not by the harness — becomes
    // attributable to this run.
    assert.equal(process.env[TEST_BRAIN_OWNER_ENV], 'token-under-test');
    const generated = markTestBrainOwnership();
    assert.match(generated, /^test-\d+-\d+$/, 'a default token identifies the run');
  } finally {
    if (previous === undefined) delete process.env[TEST_BRAIN_OWNER_ENV];
    else process.env[TEST_BRAIN_OWNER_ENV] = previous;
  }
});

test('the developer default brain port is still swept — but only for owned brains', () => {
  // 3988 stays in the sweep list (an interrupted lifecycle test orphans a brain
  // there), which is exactly why ownership, not the port, must gate the kill.
  const { TEST_BRAIN_PORTS } = require('../../test/support/staleBrains.js') as { TEST_BRAIN_PORTS: number[] };
  assert.ok(TEST_BRAIN_PORTS.includes(3988));
  assert.ok(TEST_BRAIN_PORTS.includes(3991));
});
