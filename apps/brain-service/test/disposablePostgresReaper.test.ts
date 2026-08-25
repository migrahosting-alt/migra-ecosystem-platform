/**
 * The acceptance gate must not rot as it is used.
 *
 * WHY. Every Postgres test file starts a Docker container and removes it in
 * `stop()` — when the caller remembers, and when the process lives long enough.
 * A crashed run leaves one behind forever. Eighteen were found running, some for
 * fourteen hours, and Docker Desktop degraded until container starts failed with
 * `UtilAcceptVsock: accept4 failed 110`, taking a whole block of Postgres tests
 * with them. That reads exactly like flaky tests and is not.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reapStaleContainers, STALE_CONTAINER_AGE_MS, type ExecLike } from './support/disposablePostgres.js';

const NOW = Date.parse('2026-08-25T18:00:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString().replace('T', ' ').replace('Z', ' +0000 UTC');

function docker(rows: string[]): { exec: ExecLike; removed: string[] } {
  const removed: string[] = [];
  const exec: ExecLike = async (_file, args) => {
    if (args[0] === 'ps') return { stdout: rows.join('\n') };
    if (args[0] === 'rm') removed.push(args[2]!);
    return { stdout: '' };
  };
  return { exec, removed };
}

test('a container left behind by an earlier run is removed', async () => {
  const d = docker([`migrapilot-pg-test-dead\t${at(14 * 60 * 60 * 1000)}`]);
  const reaped = await reapStaleContainers('docker', d.exec, NOW);
  assert.deepEqual(reaped, ['migrapilot-pg-test-dead']);
  assert.deepEqual(d.removed, ['migrapilot-pg-test-dead']);
});

test("a sibling file's container is left alone", async () => {
  /*
   * node's runner executes test files CONCURRENTLY. Reaping a young container
   * would kill a database another file is actively migrating — trading a slow
   * leak for an immediate, and far more confusing, failure.
   */
  const d = docker([`migrapilot-pg-test-live\t${at(30_000)}`]);
  const reaped = await reapStaleContainers('docker', d.exec, NOW);
  assert.deepEqual(reaped, []);
  assert.deepEqual(d.removed, []);
});

test('the boundary is the stated age, not a guess', async () => {
  const d = docker([
    `migrapilot-pg-test-just-under\t${at(STALE_CONTAINER_AGE_MS - 60_000)}`,
    `migrapilot-pg-test-just-over\t${at(STALE_CONTAINER_AGE_MS + 60_000)}`,
  ]);
  await reapStaleContainers('docker', d.exec, NOW);
  assert.deepEqual(d.removed, ['migrapilot-pg-test-just-over']);
});

test('an unparseable timestamp is never treated as stale', async () => {
  // Docker's `CreatedAt` format is not stable across versions. Guessing "old"
  // from a date we cannot read would remove a container in use.
  const d = docker(['migrapilot-pg-test-weird\tsome time yesterday']);
  await reapStaleContainers('docker', d.exec, NOW);
  assert.deepEqual(d.removed, []);
});

test('a docker that will not answer never fails the test that was about to run', async () => {
  const exec: ExecLike = async () => {
    throw new Error('docker daemon is not responding');
  };
  assert.deepEqual(await reapStaleContainers('docker', exec, NOW), []);
});

test('nothing to reap is not an error', async () => {
  const d = docker(['']);
  assert.deepEqual(await reapStaleContainers('docker', d.exec, NOW), []);
});
