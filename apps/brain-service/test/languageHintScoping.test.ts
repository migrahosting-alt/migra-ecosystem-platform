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
import { creoleGreetingIntent } from '../src/providers/creoleGreetingIntent.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// GREETING INTENT, NOT SUBSTRING PRESENCE  (mp-0004b)
//
// The gate above shipped the hint whenever a greeting APPEARED IN the message.
// Appearing-in is not is. An owner testing the live product typed the English
// correction "it suppose to be Bonswa"; the gate fired, the reply flipped to
// Creole, and the model answered the WORD as a greeting instead of obeying the
// SENTENCE about it — so every correction naming the right word re-triggered
// the same flip and the user could not correct their way out.
//
// Measured on staging before the fix: 3/3 Creole with the token present, 3/3
// English with "good evening" in its place.

test('a standalone greeting carries the hint', async () => {
  const system = await systemMessageFor('bonjou');
  assert.ok(system.includes(CREOLE_MARKER), 'a bare Creole greeting lost the hint');
});

test('a greeting with a natural Creole continuation carries the hint', async () => {
  // The regression risk of an intent gate is the opposite of the old bug:
  // tightening it must not switch the hint off for real Creole speakers.
  const system = await systemMessageFor('Bonjou, kijan ou ye? Mwen rele Bonex.');
  assert.ok(system.includes(CREOLE_MARKER), 'genuine Creole lost the hint');
});

test('🚨 an English correction naming a greeting does NOT carry the hint', async () => {
  // THE DEFECT. This exact sentence is what the owner typed.
  const system = await systemMessageFor('it suppose to be Bonswa');
  assert.ok(!system.includes(CREOLE_MARKER), 'an English correction triggered the Creole hint');
  assert.ok(system.includes(LANGUAGE_RULE), 'the language rule must survive');
});

test('metalinguistic discussion of a greeting does NOT carry the hint', async () => {
  for (const prompt of ['what does bonswa mean?', 'bonswa means good evening']) {
    const system = await systemMessageFor(prompt);
    assert.ok(!system.includes(CREOLE_MARKER), `discussing a greeting triggered the hint: ${prompt}`);
  }
});

test('a quoted greeting is mentioned, not used, and does NOT carry the hint', async () => {
  for (const prompt of ['the word "bonswa" is the evening greeting', "is 'bonjou' correct here?"]) {
    const system = await systemMessageFor(prompt);
    assert.ok(!system.includes(CREOLE_MARKER), `a quoted greeting triggered the hint: ${prompt}`);
  }
});

test('a textless turn is not a greeting, and does not throw', () => {
  // An image-only turn reaches the provider with userPrompt undefined. The
  // substring gate survived that by accident — RegExp.test(undefined) coerces
  // to the string "undefined" — whereas calling .replace on it throws and takes
  // the whole generation down. Four longRunningInference tests caught it.
  //
  // Asserted on the function directly: routing it through the provider would
  // also need an attachment to make a textless request well-formed, and this is
  // a statement about the gate, not about request shape.
  assert.equal(creoleGreetingIntent(undefined), false);
  assert.equal(creoleGreetingIntent(''), false);
});
