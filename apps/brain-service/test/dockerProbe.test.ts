/**
 * Regression tests for Docker daemon detection.
 *
 * Guards a defect that silently disabled the entire PostgreSQL acceptance
 * suite: the probe used `docker info`'s exit status, but Docker CLI 29.x exits
 * 0 for `info`, `ps` and `version` even with no daemon running. A client-only
 * install was therefore reported as usable, every real-database test skipped,
 * and the suite still went green.
 *
 * A skipped test is not a passing test — so the probe must never again report
 * a daemon that is not there.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dockerAvailable, dockerDaemonVersion, type ExecLike } from './support/disposablePostgres.js';

/** Docker CLI present, no daemon: exits 0 with EMPTY stdout. The real trap. */
const clientOnly: ExecLike = async () => ({ stdout: '\n' });

/** Daemon reachable: prints a version. */
const daemonUp: ExecLike = async () => ({ stdout: '27.3.1\n' });

/** Docker not installed at all. */
const noBinary: ExecLike = async () => {
  throw new Error('spawn docker ENOENT');
};

/** Daemon down and the CLI writes to stderr but still exits 0. */
const daemonDownExitZero: ExecLike = async () => ({ stdout: '' });

test('client-only Docker (exit 0, empty stdout) is NOT reported as available', async () => {
  assert.equal(await dockerDaemonVersion(clientOnly), null);
  assert.equal(await dockerAvailable(clientOnly), false);
});

test('daemon-down-but-exit-0 is NOT reported as available', async () => {
  assert.equal(await dockerAvailable(daemonDownExitZero), false);
});

test('missing docker binary is NOT reported as available', async () => {
  assert.equal(await dockerAvailable(noBinary), false);
});

test('a reachable daemon IS reported as available, with its version', async () => {
  assert.equal(await dockerDaemonVersion(daemonUp), '27.3.1');
  assert.equal(await dockerAvailable(daemonUp), true);
});

test('the probe interrogates the SERVER version, not client or exit status', async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const recording: ExecLike = async (file, args) => {
    calls.push({ file, args });
    return { stdout: '27.3.1\n' };
  };
  await dockerAvailable(recording);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.file, 'docker');
  const joined = calls[0]!.args.join(' ');
  assert.ok(joined.includes('{{.Server.Version}}'), `must query the server version, got: ${joined}`);
  assert.ok(!joined.includes('info'), 'must not rely on `docker info`');
});
