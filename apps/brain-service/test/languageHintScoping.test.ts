// mp-0004 — the Haitian Creole disambiguation hint must not ship on turns that
// are not about Creole. © MigraTeck LLC.
//
// WHY THIS TEST EXISTS. The hint was in the system prompt of EVERY assistant
// turn, and measured against the production model it flipped English answers
// into malformed Creole on 5 of 12 identical runs — reproduced on the live
// consumer, on a real user-facing conversation.
//
// The assertion is made at the TRANSPORT BOUNDARY: it reads the exact JSON body
// the provider PUTs on the wire, not an intermediate object. A field present in
// one layer is not evidence of what the model actually receives.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenAiCompatProvider } from '../src/providers/openAiCompatProvider.js';
import type { ChatTurnRequest } from '@migrapilot/shared-types';

const CREOLE_MARKER = 'Treat THOSE as Haitian Creole';
const FRENCH_GUARD = '"salut", "bonjour", "coucou"';
const LANGUAGE_RULE = 'reply in the SAME language the user wrote in';

/** Capture the serialized request body the provider sends. */
async function systemMessageFor(userPrompt: string): Promise<string> {
  const provider = new OpenAiCompatProvider({
    profile: 'default',
    baseUrl: 'http://provider.invalid/v1',
    model: 'qwen3:8b',
  });

  let sent: string | undefined;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: { body?: unknown }) => {
    sent = String(init?.body ?? '');
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof globalThis.fetch;

  try {
    const request: ChatTurnRequest = {
      feature: 'chat',
      modelProfile: 'default',
      systemPromptId: 'ai-chat-v1',
      userPrompt,
      context: {},
      outputMode: 'markdown',
    };
    await provider.complete(request);
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.ok(sent, 'the provider sent no request body');
  const body = JSON.parse(sent) as { messages: Array<{ role: string; content: string }> };
  const system = body.messages.find((m) => m.role === 'system');
  assert.ok(system, 'no system message reached the wire');
  return system.content;
}

test('an English turn carries no Haitian Creole hint', async () => {
  const system = await systemMessageFor('What is the betaSecret?');
  assert.ok(!system.includes(CREOLE_MARKER), 'the Creole hint shipped on an English turn');
  // The rule the hint was helping is NOT what gets removed — it stays on every turn.
  assert.ok(system.includes(LANGUAGE_RULE), 'the language rule must survive');
});

test('a Creole greeting still carries the hint, and its French guard with it', async () => {
  const system = await systemMessageFor('sak pase?');
  assert.ok(system.includes(CREOLE_MARKER), 'the Creole hint is missing on a Creole turn');
  // The second sentence is the first one's guard. Shipping one without the other
  // is what previously pulled French `salut` into Creole.
  assert.ok(system.includes(FRENCH_GUARD), 'the hint shipped without its guard');
});

test('French bonjour does not match Creole bonjou', async () => {
  // Whole-word matching is the entire reason `bonjour` is safe: a substring test
  // would fire the Creole hint on plain French and re-create the over-capture.
  const system = await systemMessageFor('bonjour, comment allez-vous ?');
  assert.ok(!system.includes(CREOLE_MARKER), 'French bonjour triggered the Creole hint');
});

test('the hint is matched on the user message, not on retrieved documents', async () => {
  // A user's own file may quote Creole. That is THEIR content, not a statement
  // about the language they are writing to us in.
  const system = await systemMessageFor('Summarise the attached notes.');
  assert.ok(!system.includes(CREOLE_MARKER), 'the hint leaked in from non-user text');
});
