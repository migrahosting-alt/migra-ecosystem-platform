// `/deep` agent-mode command: parsing + live rendering of tool steps and the
// streamed answer. Proves cloud escalation is opt-in, a missing workspace is a
// truthful message (not a crash), and tool steps render before the answer.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { budgetFooter, groundingFooter, parseDeepCommand, runDeepCommand, timeoutFooter } from '../../chat/deepCommand.js';
import type { MigraAiClient, AnswerStreamEvent, GroundedClaim } from '../../services/migraAiClient.js';

function sink(): { md: string; prog: string[]; s: { markdown(t: string): void; progress(t: string): void } } {
  const box = { md: '', prog: [] as string[] };
  return {
    get md() { return box.md; },
    get prog() { return box.prog; },
    s: { markdown: (t: string) => { box.md += t; }, progress: (t: string) => { box.prog.push(t); } },
  } as unknown as { md: string; prog: string[]; s: { markdown(t: string): void; progress(t: string): void } };
}

function clientYielding(events: AnswerStreamEvent[]): MigraAiClient {
  return {
    answerStream: async function* () {
      for (const e of events) yield e;
    },
  } as unknown as MigraAiClient;
}

test('parseDeepCommand: non-/deep prompt returns null (falls through to chat)', () => {
  assert.equal(parseDeepCommand('how does auth work?'), null);
  assert.equal(parseDeepCommand('/deepen the code'), null); // must be the /deep token
});

test('parseDeepCommand: bare /deep is usage; a question is an ask (local by default)', () => {
  assert.deepEqual(parseDeepCommand('/deep'), { kind: 'usage' });
  const ask = parseDeepCommand('/deep how does login work?');
  assert.deepEqual(ask, { kind: 'ask', question: 'how does login work?', tier: 'local' });
});

test('parseDeepCommand: cloud escalation is opt-in via `/deep cloud <q>`', () => {
  const ask = parseDeepCommand('/deep cloud explain the router');
  assert.deepEqual(ask, { kind: 'ask', question: 'explain the router', tier: 'cloud' });
});

test('runDeepCommand: a missing workspace is a truthful message, not a crash', async () => {
  const out = sink();
  await runDeepCommand(clientYielding([]), { kind: 'ask', question: 'x' }, undefined, out.s, new AbortController().signal);
  assert.match(out.md, /Open a folder/i);
});

test('runDeepCommand: renders tool steps before streaming the answer', async () => {
  const out = sink();
  const events: AnswerStreamEvent[] = [
    { type: 'route', model: 'qwen3-coder:30b', runner: 'local' },
    { type: 'step', step: { tool: 'search', args: { query: 'login' }, ok: true, summary: 'search(login) → 3 hit(s)' } },
    { type: 'step', step: { tool: 'read', args: { path: 'src/auth.ts' }, ok: true, summary: 'read(src/auth.ts)' } },
    { type: 'token', text: 'Login is handled in ' },
    { type: 'token', text: '`src/auth.ts:1`.' },
    { type: 'done', stepsUsed: 2, model: 'qwen3-coder:30b' },
  ];
  await runDeepCommand(clientYielding(events), { kind: 'ask', question: 'how does login work?' }, '/repo', out.s, new AbortController().signal);

  assert.match(out.md, /Investigation/);
  assert.match(out.md, /search\(login\)/);
  assert.match(out.md, /Answer/);
  assert.match(out.md, /src\/auth\.ts:1/);
  // The investigation block must appear before the answer text.
  assert.ok(out.md.indexOf('Investigation') < out.md.indexOf('Login is handled'), 'steps render before answer');
});

const CLAIM: GroundedClaim = {
  text: '`src/auth.ts:1-4` verifies the token.',
  kind: 'direct_evidence',
  sources: [{ path: 'src/auth.ts', startLine: 1, endLine: 4, excerptHash: 'abc123def4567890' }],
  confidence: 'high',
};

test('runDeepCommand: the grounding verdict is rendered after the verified answer', async () => {
  const out = sink();
  const events: AnswerStreamEvent[] = [
    { type: 'route', model: 'qwen3-coder:30b', runner: 'local' },
    { type: 'phase', phase: 'answer_verification' },
    { type: 'token', text: '`src/auth.ts:1-4` verifies the token.' },
    {
      type: 'grounding',
      claims: [CLAIM],
      rejected: [{ text: 'It also posts to Sentry.', reason: 'term-absent-from-evidence', terms: ['Sentry'] }],
      refused: false,
      evidence: { readPaths: ['src/auth.ts'], spanCount: 1, knownPathCount: 3 },
    },
    { type: 'done', stepsUsed: 1, model: 'qwen3-coder:30b' },
  ];
  await runDeepCommand(clientYielding(events), { kind: 'ask', question: 'how does login work?' }, '/repo', out.s, new AbortController().signal);

  assert.match(out.md, /✅ grounded/);
  assert.match(out.md, /1 evidenced, 1 removed/);
  assert.match(out.md, /src\/auth\.ts:1-4/);
  assert.ok(out.md.indexOf('verifies the token') < out.md.indexOf('grounded'), 'the verdict follows the answer');
  assert.ok(out.prog.some((p) => /Verifying every claim/.test(p)), 'verification is visible while it runs');
});

test('groundingFooter reports a refusal as a refusal, not as a quiet success', () => {
  assert.match(groundingFooter([], [{ text: 'x', reason: 'no-source-span', terms: [] }], true), /⛔ not answered from evidence/);
  assert.match(groundingFooter([CLAIM], [], false), /✅ grounded — 1 evidenced, 0 removed/);
  assert.match(groundingFooter([{ ...CLAIM, kind: 'inference', basis: 'hedged' }], [], true), /1 inferred/);
});

test('timeoutFooter names the call that ran out — not the whole request', () => {
  const text = timeoutFooter({
    category: 'model_call_timeout',
    callIndex: 2,
    callBudgetMs: 150_000,
    elapsedMs: 150_010,
    contextFileCount: 7,
    lastObservedPhase: 'model_inference',
    partialEvidenceAvailable: true,
    runElapsedMs: 331_000,
    modelCallsCompleted: 1,
  });
  assert.match(text, /model call #2/);
  assert.match(text, /150s budget/);
  assert.match(text, /7 file\(s\) in context/);
  assert.ok(!/request timed out/i.test(text));
  // A user cancellation is not a failure to report.
  assert.equal(timeoutFooter({ category: 'client_abort', callIndex: 1, callBudgetMs: 1, elapsedMs: 1, contextFileCount: 0, lastObservedPhase: 'model_inference', partialEvidenceAvailable: false, runElapsedMs: 1, modelCallsCompleted: 0 }), '');
});

const SPEND = {
  candidatesConsidered: 12,
  filesOpened: 3,
  spans: 3,
  evidenceUnits: 1840,
  modelCalls: 1,
  toolSteps: 0,
  expansionRounds: 0,
  binding: [] as string[],
};

test('budgetFooter reports the scope of every run, bound or not', () => {
  assert.match(budgetFooter('claims-supported', SPEND), /1 model call, 3 files opened, 1840 evidence units/);
  assert.match(budgetFooter('claims-supported', SPEND), /stopped: claims-supported/);
  assert.ok(!/bound by/.test(budgetFooter('claims-supported', SPEND)), 'nothing bound, nothing claimed');
  assert.match(
    budgetFooter('evidence-budget-exhausted', { ...SPEND, modelCalls: 2, expansionRounds: 1, binding: ['maxExpansionRounds'] }),
    /1 expansion .* bound by maxExpansionRounds/,
  );
});

test('review-3 — the expansion count is pluralised correctly', () => {
  assert.match(budgetFooter('claims-supported', { ...SPEND, expansionRounds: 1 }), /\b1 expansion\b/);
  assert.ok(!/1 expansions/.test(budgetFooter('claims-supported', { ...SPEND, expansionRounds: 1 })));
  assert.match(budgetFooter('claims-supported', { ...SPEND, expansionRounds: 2 }), /\b2 expansions\b/);
  assert.match(budgetFooter('claims-supported', { ...SPEND, expansionRounds: 5 }), /\b5 expansions\b/);
  // Zero expansions is not mentioned at all rather than rendered as "0 expansions".
  assert.ok(!/expansion/.test(budgetFooter('claims-supported', { ...SPEND, expansionRounds: 0 })));
});

test('review-3b — the scope footer renders for an exploration run that reports no plan', async () => {
  const out = sink();
  const events: AnswerStreamEvent[] = [
    { type: 'route', model: 'm', runner: 'local' },
    { type: 'token', text: '`src/a.ts:1-4` verifies the token.' },
    // The fallback emits a stop reason and spend with NO plan detail.
    { type: 'plan', stopReason: 'tool-step-budget-exhausted', spend: { ...SPEND, toolSteps: 6 } },
    { type: 'grounding', claims: [CLAIM], rejected: [], refused: false, evidence: { readPaths: ['src/a.ts'], spanCount: 1, knownPathCount: 1 } },
    { type: 'done', stepsUsed: 6, model: 'm' },
  ];
  await runDeepCommand(clientYielding(events), { kind: 'ask', question: 'q' }, '/repo', out.s, new AbortController().signal);
  assert.match(out.md, /stopped: tool-step-budget-exhausted/);
});

test('runDeepCommand renders the map cost, the scope footer and a recycled read', async () => {
  const out = sink();
  const events: AnswerStreamEvent[] = [
    { type: 'route', model: 'qwen3-coder:30b', runner: 'local' },
    { type: 'map', map: { paths: 2899, head: 'abc123', fromCache: false, builtInMs: 76 } },
    { type: 'step', step: { tool: 'read', args: { path: 'src/a.ts' }, ok: true, summary: 'fresh src/a.ts:1-40' } },
    { type: 'step', step: { tool: 'evidence(cached)', args: { path: 'src/a.ts' }, ok: true, summary: 'cache-hit src/a.ts:1-40' } },
    { type: 'token', text: '`src/a.ts:1-4` verifies the token.' },
    { type: 'plan', stopReason: 'claims-supported', spend: SPEND, plan: { candidates: [], opened: ['src/a.ts'], gaps: [] } },
    {
      type: 'grounding',
      claims: [CLAIM],
      rejected: [],
      refused: false,
      evidence: { readPaths: ['src/a.ts'], spanCount: 1, knownPathCount: 1 },
    },
    { type: 'done', stepsUsed: 1, model: 'qwen3-coder:30b' },
  ];
  await runDeepCommand(clientYielding(events), { kind: 'ask', question: 'how does login work?' }, '/repo', out.s, new AbortController().signal);

  assert.ok(out.prog.some((p) => /2899 tracked paths in 76ms/.test(p)), 'the map cost is visible');
  assert.match(out.md, /♻️.*cache-hit/, 'a recycled read is shown, not hidden');
  assert.match(out.md, /scope: 1 model call, 3 files opened/);
  assert.ok(out.md.indexOf('grounded') < out.md.indexOf('scope:'), 'grounding verdict first, then scope');
});
