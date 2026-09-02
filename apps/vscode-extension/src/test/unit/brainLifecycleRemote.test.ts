// A remote brain URL must NEVER cause us to spawn a local brain.
//
// The failure this prevents: the extension points at the governed Brain over the
// tailnet, the endpoint goes down, autoStart is on — and the extension boots a
// SECOND brain against different persistence. The product would look healthy
// while answering from an ungoverned store, which is the exact fallback this
// lane exists to remove.

import assert from 'node:assert/strict';
import test from 'node:test';

import { BrainLifecycle, isLocalBrainUrl, type EnsureResult } from '../../services/brainLifecycle.js';

/** A launcher that records whether anything was ever spawned. */
function launcher(probeResult: 'brain' | 'foreign' | 'down') {
  const spawned: string[][] = [];
  return {
    spawned,
    impl: {
      async probe() {
        return probeResult;
      },
      spawn(command: readonly string[]) {
        spawned.push([...command]);
        return { pid: 123, onExit: () => {}, kill: () => {} };
      },
      async sleep() {},
    },
  };
}

const REMOTE = 'https://migrapilot-app-core.tail9e1625.ts.net';
const COMMAND = ['bash', '-lc', 'node dist/src/server.js'];

test('loopback is recognised; anything else is remote', () => {
  for (const ok of ['http://127.0.0.1:3988', 'http://localhost:3988', 'http://[::1]:3988']) {
    assert.equal(isLocalBrainUrl(ok), true, ok);
  }
  for (const no of [REMOTE, 'http://10.10.0.13:3988', 'http://brain.internal:3988']) {
    assert.equal(isLocalBrainUrl(no), false, no);
  }
});

test('a hostname merely CONTAINING localhost is not loopback', () => {
  assert.equal(isLocalBrainUrl('http://localhost.evil.example:3988'), false);
  assert.equal(isLocalBrainUrl('http://127.0.0.1.evil.example:3988'), false);
});

test('an unparseable URL is treated as remote — the safe answer', () => {
  assert.equal(isLocalBrainUrl('not a url'), false);
  assert.equal(isLocalBrainUrl(''), false);
});

test('an unreachable REMOTE brain spawns nothing and reports "remote"', async () => {
  const l = launcher('down');
  const life = new BrainLifecycle(l.impl, () => {});
  const result: EnsureResult = await life.ensureRunning({ url: REMOTE, autoStart: true, command: COMMAND });
  assert.equal(result, 'remote');
  assert.deepEqual(l.spawned, [], 'a remote endpoint must never spawn a second brain');
  assert.equal(life.ownedPid(), undefined);
});

test('a reachable remote brain is still adopted normally', async () => {
  const l = launcher('brain');
  const life = new BrainLifecycle(l.impl, () => {});
  assert.equal(await life.ensureRunning({ url: REMOTE, autoStart: true, command: COMMAND }), 'already-brain');
  assert.deepEqual(l.spawned, []);
});

test('the LOCAL path still starts a brain — the guard did not disable auto-start', async () => {
  const l = launcher('down');
  // probe returns 'down' forever, so this reports 'unable', but the point is that
  // it TRIED: a spawn happened for a loopback URL.
  const life = new BrainLifecycle(l.impl, () => {});
  await life.ensureRunning({ url: 'http://127.0.0.1:3988', autoStart: true, command: COMMAND, maxAttempts: 1 });
  assert.equal(l.spawned.length, 1, 'loopback must still auto-start');
});
