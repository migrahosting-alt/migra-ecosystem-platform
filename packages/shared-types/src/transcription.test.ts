/**
 * The rules that stop a fabricated transcript becoming the user's message.
 *
 * Every case here is grounded in behaviour measured on this stack, not invented for the
 * test: the English-only model given French returned a fluent YouTube sign-off, and on a
 * second run a self-repeating sentence. Both were confident. Both would have been sent.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  assessTranscription,
  hasRepetition,
  mayAutoSubmit,
  micMayBeEnabled,
  rawTranscript,
  supportsHaitianCreole,
  wasNormalized,
  type RawTranscription,
  type TranscriptionCapability,
} from './transcription'

const provenance = { kind: 'machine-transcribed' as const, audioBytes: 1024, audioMime: 'audio/wav' }

const raw = (over: Partial<RawTranscription> = {}): RawTranscription => ({
  text: 'Please summarize the migration document for me.',
  detectedLanguage: 'en',
  requestedLanguage: null,
  confidence: 0.99,
  model: 'large-v3',
  englishOnly: false,
  durationMs: 900,
  provenance,
  ...over,
})

test('a detected, confident transcript is ok and may be submitted', () => {
  const result = assessTranscription(raw())
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.warnings, [])
  assert.equal(mayAutoSubmit(result), true)
})

test('THE FRENCH CASE: an English-only model can never reach ok on unrequested audio', () => {
  // This is the exact failure. base.en returned fluent English for French speech. The text
  // is confident and grammatical, so nothing in the CONTENT can save the user — only the
  // fact that the model could not have heard anything else.
  const result = assessTranscription(
    raw({
      text: 'I hope you enjoyed this video and like and subscribe to my channel.',
      model: 'base.en',
      englishOnly: true,
      detectedLanguage: 'en',
      confidence: 1,
    }),
  )
  assert.equal(result.status, 'needs_confirmation')
  assert.equal(mayAutoSubmit(result), false)
  assert.ok(result.warnings.some((w) => w.code === 'english_only_model'))
})

test('an English-only model is fine when English was explicitly requested', () => {
  // The user chose it, so nothing is being assumed on their behalf.
  const result = assessTranscription(
    raw({ model: 'base.en', englishOnly: true, requestedLanguage: 'en', confidence: 1 }),
  )
  assert.equal(result.status, 'ok')
})

test('a forced language is flagged even on a multilingual model', () => {
  const result = assessTranscription(raw({ requestedLanguage: 'ht' }))
  assert.ok(result.warnings.some((w) => w.code === 'forced_language'))
  assert.equal(result.status, 'needs_confirmation')
})

test('low-confidence detection must not silently submit', () => {
  const result = assessTranscription(raw({ confidence: 0.42 }))
  assert.equal(mayAutoSubmit(result), false)
  assert.ok(result.warnings.some((w) => w.code === 'low_confidence'))
})

test('an empty transcript is unusable, never ok', () => {
  const result = assessTranscription(raw({ text: '   ' }))
  assert.equal(result.status, 'unusable')
  assert.equal(mayAutoSubmit(result), false)
})

test('the observed self-repetition is caught', () => {
  // Verbatim second failure from base.en on French audio.
  const looping = 'I will never get you to be a You will never get me to be a You will never get me to be a'
  assert.equal(hasRepetition(looping), true)
  const result = assessTranscription(raw({ text: looping }))
  assert.equal(mayAutoSubmit(result), false)
  assert.ok(result.warnings.some((w) => w.code === 'repetition_detected'))
})

test('ordinary speech is not mistaken for repetition', () => {
  assert.equal(hasRepetition('Please summarize the migration document and list the open risks.'), false)
  // Natural repeats of a short phrase must not trip it either.
  assert.equal(hasRepetition('yes yes that is right, thank you very much'), false)
})

test('provenance survives, so a transcript stays distinguishable from typed text', () => {
  const result = assessTranscription(raw())
  assert.equal(result.provenance.kind, 'machine-transcribed')
  assert.equal(result.provenance.audioBytes, 1024)
})

test('a mic may only be enabled when the shared capability says ready', () => {
  const unavailable: TranscriptionCapability = {
    state: 'unavailable',
    model: null,
    multilingual: false,
    supportedLanguages: [],
    unavailableReason: 'No speech backend is configured.',
  }
  assert.equal(micMayBeEnabled(unavailable), false)
  assert.equal(
    micMayBeEnabled({ state: 'ready', model: 'large-v3', multilingual: true, supportedLanguages: ['en', 'ht'] }),
    true,
  )
})

test('Creole needs a multilingual model, not just a ready one', () => {
  assert.equal(
    supportsHaitianCreole({ state: 'ready', model: 'base.en', multilingual: false, supportedLanguages: ['en'] }),
    false,
  )
  assert.equal(
    supportsHaitianCreole({ state: 'ready', model: 'large-v3', multilingual: true, supportedLanguages: ['en', 'fr', 'ht'] }),
    true,
  )
})

test('requested, forced and detected stay three separate facts', () => {
  // Nobody asked; the model pinned "en" because it cannot do anything else; it cannot
  // report a detection. Collapsing any pair of these re-opens the fabrication hole.
  const pinned = assessTranscription(
    raw({ model: 'base.en', englishOnly: true, requestedLanguage: null, detectedLanguage: null, confidence: null }),
  )
  assert.equal(pinned.requestedLanguage, null, 'nobody requested a language')
  assert.equal(pinned.forcedLanguage, 'en', 'the decoder was pinned to English')
  assert.equal(pinned.detectedLanguage, null, 'an English-only model detects nothing')

  // Auto-detect on a multilingual model: nothing requested, nothing forced, something heard.
  const detected = assessTranscription(raw({ detectedLanguage: 'fr', confidence: 0.99 }))
  assert.equal(detected.requestedLanguage, null)
  assert.equal(detected.forcedLanguage, null)
  assert.equal(detected.detectedLanguage, 'fr')

  // An explicit choice is both requested and forced.
  const asked = assessTranscription(raw({ requestedLanguage: 'ht', detectedLanguage: 'ht' }))
  assert.equal(asked.requestedLanguage, 'ht')
  assert.equal(asked.forcedLanguage, 'ht')
})

/**
 * KREYÒL ORTHOGRAPHIC POST-PROCESSING.
 *
 * `text` is no longer purely what the ASR produced once the normalizer has run, so the
 * contract has to keep the original reachable. These cases pin the distinctions that are
 * easy to collapse and expensive to get wrong.
 */

test('a pipeline that does not normalize reports null, not an empty normalization', () => {
  // Distinguishable from "normalization ran and changed nothing" — only the first is a
  // reason to suspect the Kreyòl cleanup is misconfigured.
  const result = assessTranscription(raw())
  assert.equal(result.normalization, null)
  assert.equal(wasNormalized(result), false)
})

test('the raw ASR string survives normalization and is always reachable', () => {
  // A REAL repair from the qualification vectors, not an invented one: l'espri -> lespri is
  // the single apostrophe-clitic change the normalizer makes across all 94 clips.
  const result = assessTranscription(raw({
    text: 'Se lespri a ki mennen l.',
    detectedLanguage: 'ht',
    normalization: {
      applied: true,
      rawText: "Se l'espri a ki mennen l.",
      engine: 'kreyol-asr-orthographic-normalizer',
      version: 'v1',
      language: 'ht',
      changes: [{
        source: "l'espri",
        replacement: 'lespri',
        reason: 'APOSTROPHE_CLITIC_NORMALIZATION',
        evidence: 'apostrophe removed; result attested in lexicon',
      }],
    },
  }))
  assert.equal(result.text, 'Se lespri a ki mennen l.')
  assert.equal(rawTranscript(result), "Se l'espri a ki mennen l.")
  assert.equal(wasNormalized(result), true)
  assert.equal(result.normalization?.changes.length, 1)
})

test('normalization does NOT make a doubtful transcript ok', () => {
  // Tidier spelling is not evidence the ASR heard the right language. An English-only model
  // that silently gained an "ok" because its output looked clean is the original fabrication
  // hole in a new coat.
  const result = assessTranscription(raw({
    text: 'I hope you enjoyed this video and like and subscribe.',
    detectedLanguage: null,
    englishOnly: true,
    normalization: { applied: false, rawText: 'I hope you enjoyed this video and like and subscribe.', changes: [], skippedReason: 'language is en, not ht' },
  }))
  assert.equal(result.status, 'needs_confirmation')
  assert.equal(mayAutoSubmit(result), false)
})

test('a skipped normalization says WHY, so unavailable is not read as nothing-to-do', () => {
  const result = assessTranscription(raw({
    detectedLanguage: 'ht',
    normalization: { applied: false, rawText: 'Bonjou tout moun.', changes: [], skippedReason: 'normalizer unavailable: No module named asr_normalizer' },
  }))
  assert.equal(result.normalization?.applied, false)
  assert.match(result.normalization?.skippedReason ?? '', /unavailable/)
  assert.equal(wasNormalized(result), false)
})

test('normalization that ran but changed nothing is not reported as normalized', () => {
  const result = assessTranscription(raw({
    text: 'Bonjou tout moun.',
    detectedLanguage: 'ht',
    normalization: { applied: true, rawText: 'Bonjou tout moun.', changes: [] },
  }))
  assert.equal(result.normalization?.applied, true)
  assert.equal(wasNormalized(result), false)
  assert.equal(rawTranscript(result), 'Bonjou tout moun.')
})
