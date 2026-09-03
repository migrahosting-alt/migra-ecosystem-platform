// activate() must not touch a module-level singleton before it is constructed.
//
// A real, total outage: the workspace-tool executor was wired at the TOP of
// activate(), before `migraAiClient = new MigraAiClient(...)` ran. Activation
// threw "Cannot read properties of undefined", so the extension never loaded —
// the view still registered from package.json and the panel rendered blank, and
// NOTHING reached the output channel, because activation never got far enough to
// create it. Every unit test passed and the bundle was valid; only the VS Code
// remote extension-host log had the error.
//
// TypeScript cannot catch this: the singleton is declared `let x: T` and is
// therefore typed non-nullable everywhere, including before it is assigned.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src', 'extension.ts'), 'utf8');

/** Module-level singletons assigned during activate(). */
const SINGLETONS = ['migraAiClient', 'brainClient', 'router', 'outputChannel'];

function activateBody(): string {
  const start = SRC.indexOf('export async function activate(');
  assert.ok(start > 0, 'activate() not found');
  return SRC.slice(start);
}

test('no module-level singleton is USED before it is assigned in activate()', () => {
  const body = activateBody();
  const offenders: string[] = [];
  for (const name of SINGLETONS) {
    const assigned = body.indexOf(`${name} = `);
    if (assigned < 0) continue; // not assigned in activate(); nothing to order
    // First use as a receiver: `name.something(` or `name,` passed onward.
    const useRe = new RegExp(`\\b${name}\\.[a-zA-Z]`, 'g');
    let m: RegExpExecArray | null;
    while ((m = useRe.exec(body))) {
      if (m.index < assigned) {
        offenders.push(`${name} used at +${m.index} but assigned at +${assigned}`);
        break;
      }
    }
  }
  assert.deepEqual(offenders, [], 'a singleton is used before construction — activation will throw');
});

test('the workspace-tool executor is wired AFTER the client exists', () => {
  const body = activateBody();
  const constructed = body.indexOf('migraAiClient = new MigraAiClient');
  const wired = body.indexOf('setWorkspaceToolExecutor');
  assert.ok(constructed > 0 && wired > 0, 'both sites must exist');
  assert.ok(wired > constructed, 'the executor must be wired after the client is constructed');
});
