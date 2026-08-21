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
  supportsHaitianCreole,
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
