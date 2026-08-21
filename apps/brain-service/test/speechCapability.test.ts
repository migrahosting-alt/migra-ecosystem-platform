import assert from 'node:assert/strict';
import test from 'node:test';

import {
  probeSpeechCapability,
  readSpeechRuntimeConfig,
  SpeechRuntimeError,
  transcribeWithRuntime,
} from '../src/engine/speech/speechRuntime.js';

const ok = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const config = { url: 'http://runtime.invalid', timeoutMs: 5_000 };

test('with no runtime configured the capability is unavailable, never ready', () => {
  const cfg = readSpeechRuntimeConfig({} as NodeJS.ProcessEnv);
  assert.equal(cfg.url, undefined);
});

test('an unconfigured capability names the missing precondition', async () => {
  const capability = await probeSpeechCapability({ timeoutMs: 1000 });
  assert.equal(capability.state, 'unavailable');
  assert.match(String(capability.unavailableReason), /MIGRAPILOT_SPEECH_RUNTIME_URL/);
});

test('an unreachable runtime is UNAVAILABLE, not ready', async () => {
  // A surface must never open a microphone against a runtime that did not answer.
  const capability = await probeSpeechCapability(config, async () => {
    throw new Error('ECONNREFUSED');
  });
  assert.equal(capability.state, 'unavailable');
  assert.match(String(capability.unavailableReason), /could not be reached/);
});

test('a runtime that does not name its model cannot be ready', async () => {
  const capability = await probeSpeechCapability(config, async () => ok({ multilingual: true }));
  assert.equal(capability.state, 'unavailable');
});

test('a multilingual runtime is reported with its own language list', async () => {
  const capability = await probeSpeechCapability(config, async () =>
    ok({ model: 'large-v3', multilingual: true, supportedLanguages: ['en', 'fr', 'ht'] }),
  );
  assert.equal(capability.state, 'ready');
  assert.equal(capability.multilingual, true);
  assert.ok(capability.supportedLanguages.includes('ht'));
});

test('an English-only runtime is ready but not multilingual', async () => {
  const capability = await probeSpeechCapability(config, async () => ok({ model: 'base.en' }));
  assert.equal(capability.state, 'ready');
  assert.equal(capability.multilingual, false);
  assert.deepEqual(capability.supportedLanguages, ['en']);
});

test('THE FABRICATION GUARD holds through the Brain: English-only output needs confirmation', async () => {
  // The exact measured failure, delivered by a runtime: fluent English for French speech.
  const result = await transcribeWithRuntime(config, { audioBase64: 'AAAA', audioMime: 'audio/wav' }, async () =>
    ok({
      text: 'I hope you enjoyed this video and like and subscribe to my channel.',
      model: 'base.en',
      englishOnly: true,
      language: 'en',
      languageProbability: 1,
    }),
  );
  assert.equal(result.status, 'needs_confirmation');
  assert.ok(result.warnings.some((w) => w.code === 'english_only_model'));
  // And it must not present a pinned language as a detection.
  assert.equal(result.detectedLanguage, null);
  assert.equal(result.confidence, null);
});

test('a runtime language pin never becomes the user\'s request', async () => {
  // The caller asked for nothing. Whatever the runtime pinned internally, requestedLanguage
  // must stay null, or the guard above silently switches off.
  const result = await transcribeWithRuntime(config, { audioBase64: 'AAAA', audioMime: 'audio/wav' }, async () =>
    ok({ text: 'hello there', model: 'base.en', englishOnly: true, requestedLanguage: 'en' }),
  );
  assert.equal(result.requestedLanguage, null);
  assert.equal(result.status, 'needs_confirmation');
});

test('a clean multilingual transcription is ok and carries its detection', async () => {
  const result = await transcribeWithRuntime(config, { audioBase64: 'AAAA', audioMime: 'audio/wav' }, async () =>
    ok({ text: 'Bonjour, je voudrais un résumé du document.', model: 'large-v3', language: 'fr', languageProbability: 0.993 }),
  );
  assert.equal(result.status, 'ok');
  assert.equal(result.detectedLanguage, 'fr');
  assert.equal(result.confidence, 0.993);
  assert.equal(result.provenance.kind, 'machine-transcribed');
});

test('a runtime failure raises SpeechRuntimeError rather than returning empty text', async () => {
  // Returning "" would look like silence — a real, different fact from a broken runtime.
  await assert.rejects(
    () => transcribeWithRuntime(config, { audioBase64: 'AAAA', audioMime: 'audio/wav' }, async () => ok({ error: 'model failed to load' })),
    SpeechRuntimeError,
  );
})
