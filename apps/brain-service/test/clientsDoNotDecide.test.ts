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
