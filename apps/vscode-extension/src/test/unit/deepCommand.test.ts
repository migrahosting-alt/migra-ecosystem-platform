// `/deep` agent-mode command: parsing + live rendering of tool steps and the
// streamed answer. Proves cloud escalation is opt-in, a missing workspace is a
// truthful message (not a crash), and tool steps render before the answer.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDeepCommand, runDeepCommand } from '../../chat/deepCommand.js';
import type { MigraAiClient, AnswerStreamEvent } from '../../services/migraAiClient.js';

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
    { type: 'route', model: 'qwen3-coder:30b' },
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
