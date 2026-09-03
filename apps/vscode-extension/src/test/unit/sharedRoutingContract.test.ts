// One routing contract, both surfaces.
//
// These drifted, and the drift produced OPPOSITE bugs from one cause. The
// consumer answered "build this page" with a description of the screenshot. This
// surface did the reverse: any image that yielded a design spec entered the
// workspace agent, so "what is in this image?" was dragged into the build path.
// Both are the same defect — deciding routing locally instead of from the plan.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { planTurn } from '@migrapilot/shared-types/turn-intent';

const ENGINE = readFileSync(join(__dirname, '..', '..', '..', 'src', 'chat', 'chatEngine.ts'), 'utf8');

test('the extension CONSUMES the Brain decision and does not compute one', () => {
  // Cutover: routing is no longer computed here at all. It is requested.
  assert.match(ENGINE, /migraAiClient\.orchestrate\(/, 'it must ask the Brain');
  assert.doesNotMatch(ENGINE, /\bplanTurn\(/, 'the local plan builder must not run at runtime');
  assert.match(ENGINE, /decision\.requiresVision/, 'the design read follows the decision');
  assert.match(ENGINE, /decision\.requiresEngineer/, 'the agent follows the decision');
});

test('FAIL CLOSED: no local fallback when orchestration is unavailable', () => {
  // The old fallback is exactly what hid an ordinary coding request never
  // reaching the agent, while every unit test passed.
  const catchBlock = ENGINE.slice(ENGINE.indexOf('} catch (err) {'), ENGINE.indexOf('const turnPlan'));
  assert.match(catchBlock, /could not reach the orchestration service/);
  assert.match(catchBlock, /return;/, 'the turn must stop, not guess');
  assert.doesNotMatch(catchBlock, /planTurn|planOutcome/, 'it must not route locally on failure');
});

test('authority is declared truthfully, never inferred from being the extension', () => {
  assert.match(ENGINE, /openWorkspaceForAuthority\s*\?\s*\n?\s*vscodeWorkspaceAuthority/, 'a workspace only when one is open');
  assert.match(ENGINE, /NO_AUTHORITY/, 'otherwise none');
});

test('THE REGRESSION: entering the agent must not depend on a spec merely existing', () => {
  // The old condition was `(!hasImageAttachment || designSpec)` — a spec existing
  // was treated as permission to build.
  assert.doesNotMatch(
    ENGINE,
    /\(!hasImageAttachment \|\| designSpec\) && mayPromptForFolder/,
    'a design spec existing is not a reason to build',
  );
});

test('both surfaces agree on every acceptance case', () => {
  // The same five cases the consumer is held to. If this ever diverges, one
  // product has grown its own opinion about what the user wants.
  const cases: Array<[string, boolean, boolean]> = [
    // request                                  requiresEngineer  visionIsTerminal
    ['what is in this image?',                  false,            true],
    ['analyze this UI',                         false,            true],
    ['what would you improve about this?',      false,            true],
    ['build this page',                         true,             false],
    ['recreate this component',                 true,             false],
    ['make my existing page look like this',    true,             false],
  ];
  const wrong: string[] = [];
  for (const [text, engineer, terminal] of cases) {
    const p = planTurn({ text, hasImageAttachment: true });
    if (p.requiresEngineer !== engineer || p.visionIsTerminal !== terminal) {
      wrong.push(`"${text}" -> engineer=${p.requiresEngineer} terminal=${p.visionIsTerminal}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('a describe turn cannot reach the build path', () => {
  const p = planTurn({ text: 'what is in this image?', hasImageAttachment: true });
  assert.equal(p.requiresEngineer, false);
  assert.equal(p.visionIsTerminal, true, 'the read IS the answer for a describe turn');
});

test('an ordinary workspace request with no image still reaches the agent', () => {
  // Aligning on the plan must not cost the plain "fix this bug" path.
  const p = planTurn({ text: 'add a health endpoint to the server', hasImageAttachment: false });
  assert.equal(p.requiresVision, false);
  assert.equal(p.visionIsTerminal, false, 'a non-vision turn must remain eligible for the agent');
});
