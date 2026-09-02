// The suite itself must be sound before it judges anything.
//
// A qualification suite is only as trustworthy as its own guarantees: that it
// covers the contract, that its graders actually discriminate, and that its
// negative controls really do fail the degenerate strategies they name.

import assert from 'node:assert/strict';
import test from 'node:test';

import { CHAT_GENERAL_CASES, COVERED_DIMENSIONS, SUITE_REVISION } from '../src/eval/chatGeneral/cases.js';
import { DIMENSION_MINIMUMS, OVERALL_MINIMUM, verdictFor } from '../src/eval/chatGeneral/threshold.js';

test('the suite covers every dimension the capability promises', () => {
  const required = [
    'instruction_following', 'factual_discipline', 'ambiguity_handling', 'multi_turn_coherence',
    'response_control', 'structured_output', 'refusal_uncertainty', 'basic_reasoning',
    'tool_selection', 'hallucination_resistance', 'conversation_continuity', 'multilingual',
    'negative_control',
  ];
  for (const d of required) assert.ok(COVERED_DIMENSIONS.includes(d as never), `missing dimension: ${d}`);
});

test('every dimension has a declared floor, and every floor has cases', () => {
  for (const d of COVERED_DIMENSIONS) {
    assert.equal(typeof DIMENSION_MINIMUMS[d], 'number', `${d} has no floor`);
  }
  for (const d of Object.keys(DIMENSION_MINIMUMS)) {
    assert.ok(COVERED_DIMENSIONS.includes(d as never), `${d} has a floor but no cases`);
  }
});

test('every case states its intent, so a failure is actionable', () => {
  for (const c of CHAT_GENERAL_CASES) {
    assert.ok(c.intent.length > 30, `${c.id} needs a real intent`);
    assert.ok(c.turns.length > 0);
  }
});

test('graders DISCRIMINATE — each rejects a plausible wrong answer', () => {
  // A grader that passes everything measures nothing. Every case is fed an
  // answer that looks reasonable but violates its contract.
  const wrong: Record<string, string> = {
    'if-exact-token': 'Sure! Here you go: ALPHA-7',
    'if-word-count': 'The ocean is vast and deep and blue',
    'if-format-lines': '1. Red\n2. Blue\n3. Yellow',
    'fact-capital': 'The capital of Japan is Kyoto.',
    'fact-year': 'It happened in 1972.',
    'fact-count': 'There are 365 days.',
    'amb-book-it': 'I have booked it for you.',
    'amb-translate': 'Here is the translation: hello.',
    'mt-code-recall': 'I do not recall any code.',
    'mt-preference-recall': 'You said your favourite colour was red.',
    'rc-one-sentence': 'Photosynthesis is a process. It uses light. It makes sugar. It releases oxygen.',
    'rc-detailed': 'It converts light into sugar.',
    'so-json-object': 'Tokyo is the capital of Japan.',
    'so-json-array': '[1, 2]',
    'ref-bank-balance': 'Your balance is $4,200.',
    'ref-yesterday-meal': 'You had eggs and toast.',
    'reason-time': 'It arrives at 4:30 pm.',
    'reason-transitive': 'Alice',
    'reason-arithmetic': '71',
    'tool-calculator': 'web_search',
    'tool-file-reader': 'calculator',
    'hall-fake-paper': 'The paper argues that quantum effects improve consensus latency.',
    'hall-fake-city': 'Zyrxalia has a population of 240000.',
    'cont-pronoun': 'Who are you referring to?',
    'ml-haitian-creole': 'The capital of Haiti is a city in the Caribbean.',
    'ml-spanish': 'The capital is Madrid.',
    'nc-must-not-refuse': 'I do not have access to that information.',
    'nc-must-not-ask': 'Could you clarify what you mean by 2 + 2?',
    'nc-must-be-brief': 'The sky appears blue because of Rayleigh scattering.',
  };
  const undiscriminating: string[] = [];
  for (const c of CHAT_GENERAL_CASES) {
    const bad = wrong[c.id];
    assert.ok(bad !== undefined, `no wrong-answer fixture for ${c.id}`);
    if (c.grade(bad, [bad])) undiscriminating.push(c.id);
  }
  assert.deepEqual(undiscriminating, [], 'these graders accept a plainly wrong answer');
});

test('the negative controls fail the exact strategies they exist to catch', () => {
  const byId = Object.fromEntries(CHAT_GENERAL_CASES.map((c) => [c.id, c]));
  // Always-refuse: scores well on refusal + hallucination, must fail the control.
  assert.equal(byId['nc-must-not-refuse']!.grade('I cannot know that.', []), false);
  // Always-ask: scores well on ambiguity, must fail the control.
  assert.equal(byId['nc-must-not-ask']!.grade('What exactly do you mean?', []), false);
  // Always-elaborate: scores well on detail, must fail the control.
  assert.equal(byId['nc-must-be-brief']!.grade('It is a beautiful shade of blue.', []), false);
});

test('a strong average CANNOT pass while a dimension floor fails', () => {
  const dims = COVERED_DIMENSIONS.map((d) => ({
    dimension: d,
    passed: 1, total: 1, rate: 1,
    meetsFloor: d !== 'hallucination_resistance',
  }));
  const v = verdictFor(dims, 0.95);
  assert.equal(v.meetsOverall, true);
  assert.equal(v.qualifies, false, 'an average must never paper over a broken dimension');
  assert.deepEqual(v.failedDimensions, ['hallucination_resistance']);
});

test('the bar and suite are versioned, so evidence names what produced it', () => {
  assert.match(SUITE_REVISION, /^chat-general\/\d+\.\d+\.\d+$/);
  assert.ok(OVERALL_MINIMUM > 0 && OVERALL_MINIMUM <= 1);
});
