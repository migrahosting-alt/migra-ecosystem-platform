// CLIENTS EXPRESS CONTEXT AND AUTHORITY; THE BRAIN OWNS ORCHESTRATION.
//
// A structural guard, because this regresses silently and cheaply: someone adds
// "just one" condition to a client, it works, and months later the two surfaces
// disagree about what the user asked for. That has already happened twice here,
// in opposite directions, from exactly one local condition each.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Resolved from the package root: __dirname does not exist in this ESM test
// context, and a module-level throw there fails the whole file opaquely.
const REPO = join(process.cwd(), '..', '..');
const CLIENT_FILES = [
  'apps/vscode-extension/src/chat/chatEngine.ts',
  'apps/migrapilot-consumer/src/app/api/chat/stream/route.ts',
];

/** Strip comments: prose ABOUT a defect must not read as the defect. */
function code(path: string): string {
  const raw = readFileSync(join(REPO, path), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('the client files exist where this guard expects them', () => {
  for (const f of CLIENT_FILES) assert.ok(existsSync(join(REPO, f)), `${f} moved — update this guard`);
});

test('no client reintroduces "a design spec implies build"', () => {
  // The exact condition that dragged a describe turn into the build path.
  const offenders = CLIENT_FILES.filter((f) =>
    /\(\s*!hasImageAttachment\s*\|\|\s*designSpec\s*\)/.test(code(f)) ||
    /designSpec\s*(&&|\?)\s*(runEngineer|engineer|build)/i.test(code(f)),
  );
  assert.deepEqual(offenders, [], 'a client is deciding to build because a spec exists');
});

test('no client decides step ORDER for itself', () => {
  // Naming a later step next to an earlier one is sequencing, which is the
  // Brain's job. Clients may execute a step; they may not choose what follows.
  const sequencing = /changeset\.propose[\s\S]{0,120}engineer\.plan|engineer\.plan[\s\S]{0,120}workspace\.inspect/;
  const offenders = CLIENT_FILES.filter((f) => sequencing.test(code(f)));
  assert.deepEqual(offenders, [], 'a client is ordering capability steps');
});

test('no client decides whether vision may END the turn', () => {
  // visionIsTerminal may be READ from the decision; it must not be computed.
  const offenders = CLIENT_FILES.filter((f) => {
    const src = code(f);
    return /visionIsTerminal\s*=\s*(?!.*decision)/.test(src) || /const\s+visionIsTerminal\s*=/.test(src);
  });
  assert.deepEqual(offenders, [], 'a client is computing whether vision terminates the turn');
});

test('routing inputs are FACTS a client holds, not opinions it forms', () => {
  // Declaring authority and attachments is a client's job; deriving intent is not.
  for (const f of CLIENT_FILES) {
    const src = code(f);
    assert.doesNotMatch(src, /function\s+classifyBuildIntent|function\s+decideRoute/, `${f} derives its own route`);
  }
});

// ── after the cutover: clients must CONSUME the decision, not compute one ───

test('neither client runs a local plan builder at runtime', () => {
  // The shared builders may remain as a contract/test helper, but a client that
  // calls one at runtime has quietly become a second source of truth again.
  const offenders = CLIENT_FILES.filter((f) => /\bplanTurn\(|\bplanOutcome\(|unsupportedSteps\(/.test(code(f)));
  assert.deepEqual(offenders, [], 'a client is computing its own routing plan');
});

test('both clients ASK the Brain', () => {
  const asks = [
    ['apps/vscode-extension/src/chat/chatEngine.ts', /migraAiClient\.orchestrate\(/],
    ['apps/migrapilot-consumer/src/app/api/chat/stream/route.ts', /orchestrateTurn\(/],
  ] as const;
  const missing = asks.filter(([f, re]) => !re.test(code(f))).map(([f]) => f);
  assert.deepEqual(missing, [], 'a client is not requesting the decision');
});

test('FAIL CLOSED: neither client falls back locally when orchestration fails', () => {
  // The old fallback is what hid an ordinary coding request never reaching the
  // agent while every unit test passed.
  for (const f of CLIENT_FILES) {
    const src = code(f);
    // Find the failure handling around the orchestration call and prove it does
    // not route: no plan builder, and the turn stops.
    const idx = Math.max(src.indexOf('orchestrate'), 0);
    const region = src.slice(idx, idx + 2000);
    assert.doesNotMatch(region, /planTurn\(|planOutcome\(/, `${f} guesses locally when orchestration fails`);
  }
});

test('neither client alters the decision based on SURFACE', () => {
  // `surface` is provenance. Branching on it would rebuild "consumer = planner,
  // extension = builder" inside the client instead of the Brain.
  for (const f of CLIENT_FILES) {
    const src = code(f);
    assert.doesNotMatch(src, /surface\s*===\s*['"]vscode-extension['"]\s*\?/, `${f} routes on surface`);
    assert.doesNotMatch(src, /surface\s*===\s*['"]migrapilot-consumer['"]\s*\?/, `${f} routes on surface`);
  }
});

test('authority is declared, never inferred from the surface name', () => {
  const ext = code('apps/vscode-extension/src/chat/chatEngine.ts');
  // A workspace authority only when a folder is actually open.
  assert.match(ext, /workspaceFolders/, 'the extension must check for a real workspace');
  assert.match(ext, /NO_AUTHORITY/, 'and declare none when there is not one');
});
