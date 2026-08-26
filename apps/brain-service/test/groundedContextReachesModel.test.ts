/**
 * Retrieved file content must actually reach the model.
 *
 * WHY THIS EXISTS. Every earlier stage of the document path is well covered —
 * storage, exclusion, the grounding decision, the scoped relevance floor, tenant
 * isolation. What none of it proves is the LAST HOP: that the chunk text the
 * retriever selected is present in the bytes sent to the model.
 *
 * That hop is where a document feature fails most convincingly. The turn is
 * instructed to "cite these" with the file and line numbers in the prompt, so an
 * answer comes back citing `notes.md:1-4` in perfect good faith — while the
 * snippet itself was dropped somewhere between the retriever and the request
 * body, and every quoted line was invented. The citation makes it look MORE
 * trustworthy, not less.
 *
 * So these assert on the ACTUAL OUTBOUND HTTP BODY, not on an internal return
 * value. A type is not evidence that a value crossed a boundary.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OpenAiCompatProvider } from '../src/providers/openAiCompatProvider.js';
import type { ChatTurnRequest } from '@migrapilot/shared-types';

/** Captures the request body the provider actually sends. */
function capturingFetch(): { sent: () => Record<string, unknown>; impl: typeof fetch } {
  let body: Record<string, unknown> = {};
  const impl = (async (_url: string, init: RequestInit = {}) => {
    body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
    const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n';
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  return { sent: () => body, impl };
}

const realFetch = globalThis.fetch;
test.afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = realFetch;
});

function providerWith(impl: typeof fetch): OpenAiCompatProvider {
  const p = new OpenAiCompatProvider({
    profile: 'default',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5-coder:14b',
  });
  (globalThis as { fetch: typeof fetch }).fetch = impl;
  return p;
}

const turn = (context: ChatTurnRequest['context']): ChatTurnRequest => ({
  feature: 'chat',
  modelProfile: 'default',
  systemPromptId: 'x',
  userPrompt: 'what is the passphrase in my notes?',
  context,
  outputMode: 'markdown',
});

async function drain(gen: AsyncGenerator<{ delta?: string }>): Promise<void> {
  for await (const _ of gen) { /* consume */ }
}

/** Everything the model will read, as one string. */
const promptText = (body: Record<string, unknown>): string =>
  JSON.stringify((body as { messages?: unknown }).messages ?? []);

const chunk = (path: string, snippet: string) => ({
  path, startLine: 1, endLine: 4, snippet, score: 0.7, source: 'embedding' as const,
});

test('the SNIPPET TEXT itself is in the request sent to the model', async () => {
  /*
   * The assertion that matters. A citation without its content is worse than no
   * citation: the model is told to quote a file it cannot see.
   */
  const cap = capturingFetch();
  const p = providerWith(cap.impl);

  await drain(p.stream(turn({
    retrievedChunks: [chunk('notes.md', 'The passphrase is ORANGE-LADDER-42.')],
  })));

  const prompt = promptText(cap.sent());
  assert.match(prompt, /ORANGE-LADDER-42/, 'the retrieved text reached the model');
  assert.match(prompt, /notes\.md:1-4/, 'and it is attributed to its file and lines');
});

test('content the retriever did NOT select never appears', async () => {
  // Scoping is meaningless if unselected material arrives anyway.
  const cap = capturingFetch();
  const p = providerWith(cap.impl);

  await drain(p.stream(turn({
    retrievedChunks: [chunk('chosen.md', 'INCLUDED-VALUE')],
  })));

  const prompt = promptText(cap.sent());
  assert.match(prompt, /INCLUDED-VALUE/);
  assert.ok(!prompt.includes('EXCLUDED-VALUE'), 'nothing unselected leaked in');
});

test('every selected chunk arrives, not only the first', async () => {
  /*
   * A loop that stops early, or a join that keeps one element, would still pass
   * a single-chunk test — and would silently answer from a fraction of the
   * evidence while citing all of it.
   */
  const cap = capturingFetch();
  const p = providerWith(cap.impl);

  await drain(p.stream(turn({
    retrievedChunks: [
      chunk('a.md', 'ALPHA-MARKER'),
      chunk('b.csv', 'BRAVO-MARKER'),
      chunk('c.json', 'CHARLIE-MARKER'),
    ],
  })));

  const prompt = promptText(cap.sent());
  for (const marker of ['ALPHA-MARKER', 'BRAVO-MARKER', 'CHARLIE-MARKER']) {
    assert.match(prompt, new RegExp(marker), `${marker} reached the model`);
  }
  for (const path of ['a\\.md', 'b\\.csv', 'c\\.json']) {
    assert.match(prompt, new RegExp(path), `${path} is attributed`);
  }
});

test('a turn with no retrieved files sends no file context at all', async () => {
  /*
   * A plain conversation must not acquire document framing. Telling a model to
   * "cite these" when nothing was retrieved invites it to cite something.
   */
  const cap = capturingFetch();
  const p = providerWith(cap.impl);

  await drain(p.stream(turn({})));

  const prompt = promptText(cap.sent());
  assert.ok(!prompt.includes('Context from'), 'no file-context block was added');
  assert.match(prompt, /what is the passphrase in my notes\?/, 'the question still went');
});

test('an empty retrieved set is treated as none, not as an empty citation', async () => {
  // `[]` and absent must behave identically — an empty block would still tell
  // the model that documents were consulted.
  const cap = capturingFetch();
  const p = providerWith(cap.impl);

  await drain(p.stream(turn({ retrievedChunks: [] })));

  assert.ok(!promptText(cap.sent()).includes('Context from'));
});

test('the file content is carried as content, not as a filename the model must trust', async () => {
  /*
   * The failure this rules out: sending only paths and letting the model answer
   * from what it guesses a file called `credentials.md` contains.
   */
  const cap = capturingFetch();
  const p = providerWith(cap.impl);

  await drain(p.stream(turn({
    retrievedChunks: [chunk('quarterly-report.csv', 'region,total\nEMEA,1284.50')],
  })));

  const prompt = promptText(cap.sent());
  assert.match(prompt, /EMEA,1284\.50/, 'the actual rows travelled');
});
