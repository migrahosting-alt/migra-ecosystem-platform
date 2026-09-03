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

test('the extension routes from the SHARED plan, not its own image flag', () => {
  assert.match(ENGINE, /planTurn\(\{ text: trimmed, hasImageAttachment \}\)/, 'it must build the shared plan');
  assert.match(ENGINE, /turnPlan\.requiresVision/, 'the design read must be plan-driven');
  assert.match(ENGINE, /turnPlan\.requiresEngineer/, 'the agent must be entered on INTENT');
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
