// Structural guard: a Brain answer that reaches a user must carry its record.
//
// `brainClient.chat/route/retrieve` unwrap to a bare value and DISCARD the execution
// record, so a caller that renders their result has nothing to stamp and no way to see
// that the terminal revision failed to persist. That is not a style preference — it is
// the exact shape of "reported done, wasn't".
//
// This guard is source-level because the failure is a wiring mistake in a
// vscode-coupled command, which no runtime unit test in this suite can reach.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..', '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'test' && name !== 'generated') walk(p, out);
    } else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Surfaces where a discarded record would actually reach a person. */
const USER_FACING = ['/commands/', '/panel/', '/chat/'];

test('no user-facing surface consumes the record-discarding Brain wrappers', () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const rel = file.slice(SRC.length).replace(/\\/g, '/');
    if (!USER_FACING.some((d) => rel.includes(d))) continue;
    const src = readFileSync(file, 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      if (/\bbrainClient\.(chat|route|retrieve)\s*\(/.test(line)) {
        offenders.push(`src${rel}:${i + 1} ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'use the *Governed variant and present the outcome — the bare wrapper drops the record:\n' +
      offenders.join('\n'),
  );
});

test('every governed call in a user-facing surface presents its outcome', () => {
  const missing: string[] = [];
  for (const file of walk(SRC)) {
    const rel = file.slice(SRC.length).replace(/\\/g, '/');
    if (!USER_FACING.some((d) => rel.includes(d))) continue;
    const src = readFileSync(file, 'utf8');
    if (!/\bbrainClient\.\w+Governed\s*\(/.test(src)) continue;
    if (!src.includes('presentOutcome')) missing.push(`src${rel}`);
  }
  assert.deepEqual(missing, [], `governed call without presentOutcome:\n${missing.join('\n')}`);
});

test('the guard is not vacuous — it does find governed user-facing call sites', () => {
  const found = walk(SRC).filter((f) => {
    const rel = f.slice(SRC.length).replace(/\\/g, '/');
    return (
      USER_FACING.some((d) => rel.includes(d)) &&
      /\bbrainClient\.\w+Governed\s*\(/.test(readFileSync(f, 'utf8'))
    );
  });
  assert.ok(found.length >= 2, `expected governed user-facing call sites, found ${found.length}`);
});
