// Routing must come from a typed plan, not from matching a phrase.
//
// The defect: a mockup plus "can you help me build this page" produced an image
// description and generic web-development advice. The vision read terminated the
// parent turn because it happened to produce useful text, so the requested
// outcome — working software — was never attempted.

import assert from 'node:assert/strict'
import test from 'node:test'

import { planTurn, unmetPrerequisites } from '@migrapilot/shared-types/turn-intent'

const withImage = (text: string) => planTurn({ text, hasImageAttachment: true })

test('THE REGRESSION: "can you help me build this page" is an implementation intent', () => {
  const plan = withImage('can you help me build this page')
  assert.equal(plan.intent, 'implement')
  assert.equal(plan.requiresEngineer, true)
  assert.equal(plan.visionIsTerminal, false, 'a description must not be able to end this turn')
})

test('the same image routes differently by OUTCOME, not by wording', () => {
  const expected: Array<[string, string, boolean]> = [
    // request                                    intent            vision may end the turn
    ['what is in this image?',                    'describe',        true],
    ['describe this',                             'describe',        true],
    ['analyze this UI',                           'analyze',         true],
    ['what would you improve about this design?', 'critique',        true],
    ['build this page',                           'implement',       false],
    ['recreate this component',                   'implement',       false],
    ['implement this design',                     'implement',       false],
    ['code this up for me',                       'implement',       false],
    ['make my existing page look like this',      'modify_existing', false],
    ['update my current site to match this',      'modify_existing', false],
  ]
  const wrong: string[] = []
  for (const [text, intent, terminal] of expected) {
    const p = withImage(text)
    if (p.intent !== intent || p.visionIsTerminal !== terminal) {
      wrong.push(`"${text}" -> ${p.intent}/terminal=${p.visionIsTerminal}, expected ${intent}/${terminal}`)
    }
  }
  assert.deepEqual(wrong, [])
})

test('phrasings of ONE outcome all land on the same intent', () => {
  // Variations, not a keyword list: a missed phrasing should cost a signal, not
  // a new branch in a router.
  for (const text of ['build this', 'create this page', 'make this', 'develop this screen', 'turn this into a page', 'write the code for this']) {
    assert.equal(withImage(text).intent, 'implement', text)
  }
})

test('a modify request is distinguished from a create request', () => {
  assert.equal(withImage('make my page look like this').intent, 'modify_existing')
  // No existing target named — this is a fresh build.
  assert.equal(withImage('make this page').intent, 'implement')
})

test('an image with no outcome verb defaults to describing, never to building', () => {
  const p = withImage('here')
  assert.equal(p.intent, 'describe')
  assert.equal(p.requiresEngineer, false, 'guessing "build" would risk the user’s project')
})

test('missing prerequisites are named concretely, not answered around', () => {
  const plan = withImage('build this page')
  const missing = unmetPrerequisites(plan, { workspaceAvailable: false, engineerAvailable: true })
  assert.deepEqual(missing, ['an editable project to build in'])
  // With everything present, nothing is missing.
  assert.deepEqual(unmetPrerequisites(plan, { workspaceAvailable: true, engineerAvailable: true }), [])
})

test('plain conversation needs neither vision nor engineer', () => {
  const p = planTurn({ text: 'what is the capital of France?', hasImageAttachment: false })
  assert.equal(p.intent, 'converse')
  assert.equal(p.requiresVision, false)
  assert.equal(p.requiresEngineer, false)
})
