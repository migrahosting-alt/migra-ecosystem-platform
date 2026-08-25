/**
 * Deliberation is opt-in.
 *
 * WHY. `qwen3` is a reasoning model. Asked to "reply with exactly the word:
 * rendered" it produced 718 characters of internal monologue and then the
 * 8-character answer, in 26.6s; with deliberation off it answered identically in
 * 0.81s. Traced through the real product, a browser turn spent 33.0s of 37.0s
 * waiting for the first CONTENT token — a stream cannot yield a thinking token,
 * so the page just sits there.
 *
 * The field is asserted ON THE WIRE. Only `reasoning_effort` is honoured by the
 * OpenAI-compatible endpoint; `think` and `chat_template_kwargs` are accepted and
 * silently discarded. A test that checked the request object rather than the
 * serialized body would pass while the setting never left the process.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OpenAiCompatProvider } from '../src/providers/openAiCompatProvider.js';
import type { ChatTurnRequest } from '@migrapilot/shared-types';

const turn = (reasoning?: 'none' | 'default'): ChatTurnRequest => ({
  feature: 'chat',
  modelProfile: 'default',
  systemPromptId: 'ai-chat-v1',
  userPrompt: 'Reply with exactly the word: rendered',
  context: {},
  outputMode: 'markdown',
  ...(reasoning ? { reasoning } : {}),
});

/**
 * Capture the body actually serialized to the provider endpoint.
 *
 * The provider uses the global fetch — an earlier version of this test passed a
 * `fetchImpl` option that does not exist, so every case made a REAL 48-second
 * call to the live model and failed for the wrong reason.
 */
function captureBody(): { bodies: Record<string, unknown>[]; restore: () => void } {
  const bodies: Record<string, unknown>[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init: RequestInit = {}) => {
    bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: 'rendered' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { bodies, restore: () => void (globalThis.fetch = original) };
}

const provider = () =>
  new OpenAiCompatProvider({
    profile: 'default',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen3:8b',
  });

test('an ordinary chat turn asks for no deliberation, on the wire', async () => {
  const { bodies, restore } = captureBody();
  try {
    await provider().complete(turn('none'));
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0]!.reasoning_effort, 'none', `body was ${JSON.stringify(bodies[0])}`);
  } finally {
    restore();
  }
});

test('a reasoning turn keeps its deliberation — the field is absent, not "none"', async () => {
  // Sending `reasoning_effort: 'none'` here would silently disable the very
  // capability the turn was routed for.
  const { bodies, restore } = captureBody();
  try {
    await provider().complete(turn('default'));
    assert.ok(!('reasoning_effort' in bodies[0]!), `body was ${JSON.stringify(bodies[0])}`);
  } finally {
    restore();
  }
});

test('a request that says nothing about reasoning is left alone', async () => {
  // Callers other than chat build this request too; absence must not become a
  // silent downgrade of their behaviour.
  const { bodies, restore } = captureBody();
  try {
    await provider().complete(turn());
    assert.ok(!('reasoning_effort' in bodies[0]!));
  } finally {
    restore();
  }
});
