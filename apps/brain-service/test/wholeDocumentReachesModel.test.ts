/**
 * A WHOLE DOCUMENT AND A SAMPLE MUST NEVER LOOK THE SAME TO THE MODEL.
 *
 * 🚨 THE MEASURED FAILURE, staging 2026-09-26. A 31-slide deck was attached in
 * chat. The deck is 74 chunks and the answer was built from 6 — 8% — and it then
 * told the user it "couldn't find any content for slides before 11 or after 29".
 * All 31 slides had been extracted and indexed; nothing was missing.
 *
 * 🚨 THE MODEL WAS NOT THE DEFECT. `hybridRetriever` counted what it dropped and
 * the count was discarded before it reached a prompt, so the model had no way to
 * know it held a sample. It described its context truthfully and the PRODUCT had
 * withheld that the context was a sample — turning its own truncation into the
 * model's false statement about someone's document.
 *
 * These assert on the ACTUAL OUTBOUND HTTP BODY, following
 * `groundedContextReachesModel.test.ts`: a type is not evidence that a value
 * crossed a boundary, and the boundary is exactly where this was lost.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OpenAiCompatProvider } from '../src/providers/openAiCompatProvider.js';
import type { ChatTurnRequest } from '@migrapilot/shared-types';

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
  userPrompt: 'summarise the whole deck',
  context,
  outputMode: 'markdown',
});

async function drain(gen: AsyncGenerator<{ delta?: string }>): Promise<void> {
  for await (const _ of gen) { /* consume */ }
}

const promptText = (body: Record<string, unknown>): string =>
  JSON.stringify((body as { messages?: unknown }).messages ?? []);

test('🚨 a whole document reaches the model, with its text and labelled ENTIRE', async () => {
  const cap = capturingFetch();
  const p = providerWith(cap.impl);

  await drain(p.stream(turn({
    wholeDocuments: [{
      path: 'deck.pptx',
      text: 'Slide 1 --- Opening\nSlide 31 --- CLOSING MARKER OMEGA',
      complete: true,
    }],
  })));

  const prompt = promptText(cap.sent());
  // The far end of the document must be present — a sample would hold the start.
  assert.match(prompt, /CLOSING MARKER OMEGA/, 'the document text never reached the model');
  assert.match(prompt, /ENTIRE document/i, 'the model was not told this was the whole document');
});

test('🚨 a sampled document carries how much of it was supplied', async () => {
  const cap = capturingFetch();
  const p = providerWith(cap.impl);

  await drain(p.stream(turn({
    retrievedChunks: [{
      path: 'deck.pptx', startLine: 1, endLine: 4,
      snippet: 'Slide 12 --- Three card layout', score: 0.7, source: 'embedding',
    }],
    retrievalCoverage: [{ path: 'deck.pptx', passagesProvided: 6, passagesTotal: 74 }],
  })));

  const prompt = promptText(cap.sent());
  assert.match(prompt, /6 of 74 passages/, 'the coverage was not stated to the model');
  // The instruction that forbids the one bad inference.
  assert.match(prompt, /do not state that something is missing/i,
    'nothing stopped the model reporting absence from a sample');
});

test('🚨 read-whole and sampled do not render identically', async () => {
  /*
   * THE PROPERTY, stated directly. "The deck does not mention pricing" is sound
   * from a document read whole and is a fabrication from 6 of 74 passages. If
   * both render the same, that distinction cannot be made by anything downstream.
   */
  const whole = capturingFetch();
  await drain(providerWith(whole.impl).stream(turn({
    wholeDocuments: [{ path: 'deck.pptx', text: 'Slide 1 --- Opening', complete: true }],
  })));

  const sampled = capturingFetch();
  await drain(providerWith(sampled.impl).stream(turn({
    retrievedChunks: [{
      path: 'deck.pptx', startLine: 1, endLine: 4,
      snippet: 'Slide 1 --- Opening', score: 0.7, source: 'embedding',
    }],
    retrievalCoverage: [{ path: 'deck.pptx', passagesProvided: 1, passagesTotal: 74 }],
  })));

  assert.notEqual(promptText(whole.sent()), promptText(sampled.sent()));
  assert.ok(!/passages from/.test(promptText(whole.sent())),
    'a document read WHOLE was given a sampling caveat — that teaches needless hedging');
});

test('an incomplete whole document says what could not be read', async () => {
  const cap = capturingFetch();
  const p = providerWith(cap.impl);

  await drain(p.stream(turn({
    wholeDocuments: [{
      path: 'deck.pptx',
      text: 'Slide 1 --- Opening',
      complete: false,
      incompleteReason: 'This deck contains charts, which cannot be read as text.',
    }],
  })));

  const prompt = promptText(cap.sent());
  assert.match(prompt, /charts, which cannot be read as text/,
    'the one concrete limitation the product knew about never reached the answer');
});

test('full coverage adds no caveat', async () => {
  // A document whose every passage was supplied is not partial, and telling the
  // model otherwise would make it hedge about something it holds entirely.
  const cap = capturingFetch();
  const p = providerWith(cap.impl);

  await drain(p.stream(turn({
    retrievedChunks: [{
      path: 'notes.md', startLine: 1, endLine: 4,
      snippet: 'all of it', score: 0.7, source: 'embedding',
    }],
    retrievalCoverage: [{ path: 'notes.md', passagesProvided: 3, passagesTotal: 3 }],
  })));

  assert.ok(!/passages from notes\.md/.test(promptText(cap.sent())),
    'a fully covered document was described as a sample');
});

test('a turn grounded only on a whole document is treated as having evidence', async () => {
  /*
   * `hasWorkspaceContext` counted passages only, so the turn holding the MOST
   * evidence — an entire document and no chunks — looked like the turn holding
   * none, and took the ungrounded identity.
   */
  const cap = capturingFetch();
  const p = providerWith(cap.impl);

  await drain(p.stream(turn({
    wholeDocuments: [{ path: 'deck.pptx', text: 'Slide 1 --- Opening', complete: true }],
  })));

  const system = JSON.stringify(
    ((cap.sent() as { messages?: Array<{ role: string; content: unknown }> }).messages ?? [])
      .filter((m) => m.role === 'system'),
  );
  assert.match(system, /workspace|document|file|repo/i,
    'a turn carrying a whole document was framed as having no evidence');
});
