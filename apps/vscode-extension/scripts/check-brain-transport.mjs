#!/usr/bin/env node
// Structural anti-bypass guard for the governed Brain transport.
//
// Fails if any production source file other than the approved adapter performs a
// direct Brain-targeting `fetch()`. The allowlist is deliberately exact and minimal:
// widening it is a visible, reviewable act rather than an accident.
//
// Why a scanner and not a lint rule: the invariant is "no SECOND path to the Brain
// exists", which is a property of the file set, not of any single file.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;

/** The only files permitted to call fetch() against the Brain. */
const ALLOWLIST = new Set([
  'services/brainTransport.ts', // the transport primitive itself
]);

/** Markers that make a fetch() Brain-targeting. */
const BRAIN_MARKERS = [/brainUrl/i, /brainServiceUrl/i, /3988/, /\/health\b/, /\bbrain\b/i];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'test') continue; // test-only transports are permitted
      walk(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];

for (const file of walk(SRC)) {
  const rel = file.slice(SRC.length);
  if (ALLOWLIST.has(rel)) continue;

  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // Ignore comments — a comment mentioning fetch is documentation, not a call.
    const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
    if (!/\bfetch\s*\(/.test(code)) return;
    if (/fetchImpl/.test(code)) return; // injected test transport

    // Brain-targeting if this line or its immediate context names the Brain.
    const context = lines.slice(Math.max(0, i - 6), i + 2).join('\n');
    if (!BRAIN_MARKERS.some((m) => m.test(context))) return;

    violations.push(`${rel}:${i + 1}  ${line.trim()}`);
  });
}

if (violations.length > 0) {
  console.error('\nDirect Brain fetch() found outside the approved transport adapter:\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    '\nRoute it through runBrainOperation() in services/brainTransport.ts, or — if it is\n' +
      'genuinely not Brain traffic — make that unambiguous at the call site.\n',
  );
  process.exit(1);
}

console.log(`brain-transport: OK — no direct Brain fetch outside ${[...ALLOWLIST].join(', ')}`);
