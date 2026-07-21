// Regression: conversation "brain memory" — the summary sent to the engine must
// carry the ASSISTANT's actual prior replies, not a blanked placeholder, so a
// follow-up like "continue with the plan you proposed" can be answered instead of
// the model responding with generic amnesia. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeChatContext, summarizeTurns, parseSummaryTurns } from '../../chat/conversationSummary.js';

test('summarizeTurns carries the assistant\'s ACTUAL text (never a blanked placeholder)', () => {
  const s = summarizeTurns([
    { role: 'user', text: 'Help me design MigraWatch, a monitoring PWA.' },
    { role: 'assistant', text: 'Plan: 1) service registry 2) health poller 3) alert rules 4) PWA shell.' },
    { role: 'user', text: 'continue with the plan you propose' },
  ]);
  assert.match(s, /assistant: Plan: 1\) service registry/, 'the assistant plan must be present');
  assert.doesNotMatch(s, /previous response/, 'must never blank the assistant turn');
  assert.match(s, /user: continue with the plan/);
});

test('summarizeChatContext (VS Code turns) extracts assistant markdown, not a placeholder', () => {
  const history = [
    { prompt: 'build MigraWatch' },
    { response: [{ value: { value: 'Here is the MigraWatch build plan: step one.' } }] },
    { prompt: 'continue' },
  ];
  const s = summarizeChatContext(history);
  assert.match(s, /assistant: Here is the MigraWatch build plan/);
  assert.doesNotMatch(s, /previous response/);
});

test('empty / whitespace turns are dropped; empty history yields empty summary', () => {
  assert.equal(summarizeTurns([]), '');
  assert.equal(summarizeTurns([{ role: 'user', text: '   ' }]), '');
});

test('over-long history keeps the MOST RECENT turns (a "continue" depends on them)', () => {
  const turns = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text: `msg-${i} ${'x'.repeat(400)}` }));
  const s = summarizeTurns(turns);
  // The newest turn survives; a very old one is dropped by the budget.
  assert.match(s, /msg-39/, 'newest turn retained');
  assert.doesNotMatch(s, /msg-0\b/, 'oldest turn dropped for budget');
});

test('a single very long turn is clipped, not allowed to blow the budget', () => {
  const s = summarizeTurns([{ role: 'assistant', text: 'A'.repeat(50_000) }]);
  assert.ok(s.length < 2_000, `clipped (${s.length} chars)`);
  assert.match(s, /…$/, 'clip marker present');
});

// ── unified agent: the summary is re-expanded into structured turns ───────────
// The workspace agent takes `{role,text}[]`, while every chat surface produces the
// budgeted `user:/assistant:` summary above. Parsing it back keeps ONE budgeting
// policy rather than two history representations that can drift apart.

test('parseSummaryTurns round-trips a rendered summary into role-tagged turns', () => {
  const turns = [
    { role: 'user', text: 'design a health poller' },
    { role: 'assistant', text: 'It polls /health every 30s.' },
    { role: 'user', text: 'now build it' },
  ];
  assert.deepEqual(parseSummaryTurns(summarizeTurns(turns)), turns);
});

test('parseSummaryTurns keeps multi-line assistant text with its own turn', () => {
  const parsed = parseSummaryTurns('user: build it\nassistant: Step 1\nStep 2\nStep 3');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1]!.role, 'assistant');
  assert.equal(parsed[1]!.text, 'Step 1\nStep 2\nStep 3');
});

test('parseSummaryTurns yields nothing for an empty summary', () => {
  assert.deepEqual(parseSummaryTurns(''), []);
  assert.deepEqual(parseSummaryTurns('   '), []);
});
