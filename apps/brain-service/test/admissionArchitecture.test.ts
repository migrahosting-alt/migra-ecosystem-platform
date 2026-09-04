// Admission control must be impossible to forget, and impossible to fork.
//
// 🚨 THE DEFECT THIS CLOSES IS NOT "THE ENGINEER ROUTE HAD NO GATE". It is that
// protecting a second route required someone to REMEMBER to paste a block into it.
// The chat path gated on capacity for weeks while the coding agent — the product —
// did not, and nothing anywhere said so. Fixing the two routes leaves the next one
// exposed; fixing the SHAPE does not.
//
// So these are structural assertions, checked in CI, about code that does not exist
// yet as much as code that does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

function repoRoot(): string {
  let dir = process.cwd(); // never __dirname: this package is ESM
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('repository root not found from ' + process.cwd());
}

const ROOT = repoRoot();
const SRC = 'apps/brain-service/src';

function sources(): string[] {
  return execFileSync('git', ['ls-files', '--', SRC], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\n')
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
}

const read = (f: string): string => readFileSync(path.join(ROOT, f), 'utf8');

/**
 * `providerFor` is the function that hands a caller a LIVE model adapter. Anything
 * that calls it is about to spend a user's time on the GPU, which is precisely the
 * moment admission control exists for. Keyed on that rather than on a filename, so
 * a new route is covered the day it is written.
 */
test('every path that obtains a live model adapter goes through admission control', () => {
  const entryPoints = sources().filter((f) => /\bproviderFor\s*\(/.test(read(f)));

  // A rule that matches nothing passes forever. Observed in this very session: a
  // test asserting against evidence it had never collected looked green.
  assert.ok(entryPoints.length >= 2, `expected model-serving entry points, found ${entryPoints.length} — has providerFor been renamed?`);

  const ungated = entryPoints.filter((f) => !/AdmissionGate/.test(read(f)));
  assert.deepEqual(
    ungated,
    [],
    'these obtain a live model adapter without admission control, so a busy or unreachable card '
      + 'becomes a multi-minute wait ending in a generic failure:\n  ' + ungated.join('\n  '),
  );
});

/**
 * One implementation, reached through one door.
 *
 * The predecessor was a single 313-line file mixing probes, policy, wording and
 * enforcement, imported piecemeal by three callers. Splitting it only helps if
 * callers cannot reach around the front door and bind themselves to internals.
 */
test('admission internals are reached only through the module index', () => {
  const offenders = sources()
    .filter((f) => !f.includes('/admission/'))
    .filter((f) => /from\s+'[^']*admission\/(?!index)/.test(read(f)));
  assert.deepEqual(offenders, [], `these bypass the admission index and bind to its internals:\n  ${offenders.join('\n  ')}`);
});

test('the superseded capacity module is gone, not merely unused', () => {
  // A second implementation left behind is a second implementation that will drift.
  assert.equal(existsSync(path.join(ROOT, SRC, 'engine/capacity/gpuCapacity.ts')), false);
  const stragglers = sources().filter((f) => /capacity\/gpuCapacity/.test(read(f)));
  assert.deepEqual(stragglers, [], 'still importing the retired module');
});

/**
 * The policy is the part worth reasoning about, so it must stay reasonable about:
 * no network, no clock, no environment. If I/O creeps in, every future case needs a
 * fetch double again and the branches stop being readable as data.
 */
test('the admission policy stays pure', () => {
  const policy = read(`${SRC}/engine/admission/policy.ts`);
  for (const forbidden of ['fetch(', 'Date.now(', 'process.env', 'setTimeout(']) {
    assert.ok(!policy.includes(forbidden), `policy.ts must contain no I/O — found ${forbidden}`);
  }
});

test('operational thresholds are configurable, not buried in the algorithm', () => {
  const thresholds = read(`${SRC}/engine/admission/thresholds.ts`);
  const policy = read(`${SRC}/engine/admission/policy.ts`);
  const gate = read(`${SRC}/engine/admission/gate.ts`);
  // Every tunable is env-overridable...
  for (const v of ['SIGNAL_TIMEOUT_MS', 'COMPUTE_TIMEOUT_MS', 'COLD_LOAD_HEADROOM_BYTES', 'CACHE_TTL_MS']) {
    assert.match(thresholds, new RegExp(`MIGRAPILOT_ADMISSION_${v}`), `${v} must be overridable`);
  }
  // ...and none is re-hard-coded where the decision is made.
  assert.ok(!/\b\d+_000\b/.test(policy), 'policy.ts must take its numbers from thresholds');
  assert.ok(!/14 \* 1024/.test(gate) && !/6_000/.test(gate), 'gate.ts must take its numbers from thresholds');
});
