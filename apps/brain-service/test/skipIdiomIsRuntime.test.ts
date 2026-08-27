/**
 * The harness must report a missing environment as SKIPPED, never as failure.
 *
 * 🚨 This exists because of a defect that cost real debugging time: with the
 * Docker daemon down the suite reported **140 failures and 65 skips**, and the
 * failures were all "Cannot read properties of undefined" — a suite screaming
 * about product regressions when nothing was wrong with the product.
 *
 * It was one mistake repeated 158 times:
 *
 *     test('...', { skip: skip ?? false }, async () => { ... })
 *
 * `skip` is assigned inside `before()`, but node's runner evaluates a test's
 * OPTIONS OBJECT when the file is loaded — before any hook has run. So `skip`
 * was always still `null`, the option was always `false`, the test always ran,
 * and it then used a connection that `before()` had declined to open.
 *
 * The correct form checks at RUN time, inside the body, and names the reason:
 *
 *     test('...', async (t) => { if (skip) return t.skip(skip); ... })
 *
 * A false RED is not harmless. It trains everyone to read failures as noise,
 * which is exactly how a true failure gets waved through.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('.', import.meta.url).pathname;
const files = readdirSync(DIR).filter((f) => f.endsWith('.test.ts'));

test('no test decides to skip at module-load time', () => {
  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(join(DIR, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      // Prose is not code. This file documents the broken form on purpose, and
      // a checker that cannot tell an example from an occurrence would either
      // fail forever or have to stop checking itself.
      const code = line.trim();
      if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
      // Any `skip:` in an options object fed from a variable the hooks set. A
      // literal `skip: true` is fine — that value is knowable at load time.
      if (/\{[^}]*\bskip:\s*(?!true\b|false\b)[A-Za-z_$]/.test(line)) {
        offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 90)}`);
      }
    });
  }
  assert.deepEqual(
    offenders, [],
    'these decide to skip before before() has run, so they never skip:\n' + offenders.join('\n'),
  );
});

test('every suite that needs PostgreSQL guards at run time', () => {
  const missing: string[] = [];
  for (const f of files) {
    const src = readFileSync(join(DIR, f), 'utf8');
    // Only files that actually gate on the environment. The helper's own unit
    // tests use a mocked exec and need no real database.
    if (!src.includes('postgresTestSkipReason')) continue;
    if (!/if \(skip\)/.test(src)) missing.push(f);
  }
  assert.deepEqual(missing, [], `these ask for a skip reason and never act on it: ${missing.join(', ')}`);
});
