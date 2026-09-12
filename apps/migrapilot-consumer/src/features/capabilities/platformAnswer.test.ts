/**
 * The ten answers that were wrong, pinned so they cannot come back.
 *
 * Each case below is a VERBATIM question from the staging run of 2026-09-12,
 * paired with what the model actually said and what the registry actually knew.
 * The assertions are about the capability-owned answer replacing that prose.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  platformCapabilityAnswer,
  platformCapabilityFact,
  platformCapabilityTopics,
  renderPlatformCapabilities,
  type PlatformCapabilitySnapshot,
} from './platformAnswer'

/** Staging as measured: signed in, search and email registered-but-unconfigured,
 *  four vision models installed and none approved, no speech runtime. */
const STAGING: PlatformCapabilitySnapshot = {
  signedIn: true,
  registry: [
    { id: 'migra.search', available: false, unavailableReason: 'Web search is not set up yet.' },
    { id: 'migra.email', available: false, unavailableReason: 'Email is not set up yet.' },
    { id: 'terminal.exec', available: false },
    { id: 'file.read', available: true },
  ],
  vision: {
    state: 'no_qualified_model',
    message:
      'Your image is saved. Reading images in a conversation is not enabled yet — no vision model has been approved for use.',
  },
  speech: {
    state: 'disabled',
    reason:
      'No speech runtime is configured. Set MIGRAPILOT_SPEECH_RUNTIME_URL to a qualified transcription runtime.',
  },
}

const answer = (prompt: string, snapshot = STAGING) =>
  platformCapabilityAnswer(platformCapabilityTopics(prompt), snapshot).text

/* ── the ten captured failures ──────────────────────────────────────────── */

test('1. "what can you actually do for me right now?" answers from the registry, not from priors', () => {
  const text = answer('What can you actually do for me right now?')
  assert.ok(text.length > 0, 'an overview must be answered')
  // It must cover the topics that were previously misdescribed.
  for (const label of ['Reading documents you attach', 'Searching the web', 'Understanding images', 'Transcribing audio']) {
    assert.ok(text.includes(label), `overview is missing "${label}"`)
  }
})

test('2. it does NOT claim it can search the web — the model said "I can scour the web"', () => {
  const text = answer("Can you search the web for today's news?")
  assert.match(text, /Searching the web — no\./)
  assert.ok(text.includes('Web search is not set up yet.'), "the engine's own sentence must be used")
  assert.doesNotMatch(text, /\bI can\b/i)
})

test('3. it does NOT deny reading PDFs — the model said "I do not have the ability to read files"', () => {
  const text = answer('Can you read a PDF if I attach one?')
  assert.match(text, /Reading documents you attach — yes\./)
  assert.ok(/PDF/.test(text))
})

test('4. images are BLOCKED, not denied — the model said "I\'m a text-based AI"', () => {
  const text = answer('Can you look at an image and tell me what is in it?')
  assert.match(text, /Understanding images — not right now\./)
  assert.ok(text.includes('no vision model has been approved'), "the gate's own sentence must be used")
  // The distinction that matters: this is an approval away, not absent.
  assert.equal(platformCapabilityFact('images', STAGING).state, 'blocked')
})

test('5. email uses the engine\'s sentence, and invents nothing about the account', () => {
  const text = answer('Can you check my email?')
  assert.match(text, /Reading your email — no\./)
  assert.ok(text.includes('Email is not set up yet.'))
  // The model had said "you don't have an email set up yet" — a claim about the USER.
  assert.doesNotMatch(text, /you don'?t have an email/i)
})

test('6. it does NOT offer to open a path on the user\'s computer', () => {
  const text = answer('Can you open a file from my computer?')
  assert.match(text, /Reading your uploaded files — yes\./)
  assert.ok(text.includes('Local paths on your own computer are not readable.'))
  assert.doesNotMatch(text, /provide me with the path/i)
})

test('7. "write and run code" separates writing from running', () => {
  const text = answer('Can you write and run code for me?')
  assert.match(text, /Running code — no\./)
  assert.ok(text.includes('Explaining, writing and reviewing it is.'))
  // The model had said "Certainly!" to the whole question.
  assert.doesNotMatch(text, /^Certainly/i)
})

test('8. memory is available — the model said "I\'m a stateless AI"', () => {
  const text = answer('Can you remember what we discussed yesterday?')
  assert.match(text, /Remembering earlier conversations — yes\./)
  assert.ok(/History/.test(text))
  assert.doesNotMatch(text, /stateless/i)
})

test('9. image generation is reported as unconfigured, not attempted', () => {
  const text = answer('Can you make me a picture of a blue circle?')
  assert.match(text, /Generating images — no\./)
  assert.ok(text.includes('not configured on this server'))
})

test('10. it does NOT offer transcription — the model said "I can process WAV or MP3 files"', () => {
  const text = answer('Can you transcribe an audio recording?')
  assert.match(text, /Transcribing audio — no\./)
  assert.ok(text.includes('MIGRAPILOT_SPEECH_RUNTIME_URL'), "the runtime's own sentence must be used")
  assert.doesNotMatch(text, /please share the audio/i)
})

/* ── the detector must not hijack ordinary questions ────────────────────── */

test('an ordinary question about a subject is NOT a capability question', () => {
  for (const prompt of [
    'Explain what a PDF is.',
    'How does web search work under the hood?',
    'Write me a function that transcribes audio.',
    'What is the difference between an image and a vector graphic?',
    'Summarise this document for me.',
    'My email to the supplier bounced — why might that happen?',
  ]) {
    assert.deepEqual(platformCapabilityTopics(prompt), [], `hijacked: ${prompt}`)
  }
})

test('an attached document always wins — the document path answers better than a table', () => {
  assert.deepEqual(
    platformCapabilityTopics('Can you read this PDF?', { hasAttachments: true }),
    [],
  )
  // …and without the attachment it IS a capability question.
  assert.deepEqual(platformCapabilityTopics('Can you read a PDF?'), ['documents'])
})

test('a long message is a task, not a question about the product', () => {
  const long = 'Can you read this? ' + 'x'.repeat(300)
  assert.deepEqual(platformCapabilityTopics(long), [])
})

test('one question can ask about several things at once', () => {
  const topics = platformCapabilityTopics('Can you search the web or check my email?')
  assert.ok(topics.includes('web-search'))
  assert.ok(topics.includes('email'))
})

/* ── state model ───────────────────────────────────────────────────────── */

test('the four states stay distinct — "no" would hide the one that is actionable', () => {
  assert.equal(platformCapabilityFact('documents', STAGING).state, 'available')
  assert.equal(platformCapabilityFact('images', STAGING).state, 'blocked')
  assert.equal(platformCapabilityFact('web-search', STAGING).state, 'not-configured')
  const noRegistry: PlatformCapabilitySnapshot = { ...STAGING, registry: [] }
  assert.equal(platformCapabilityFact('web-search', noRegistry).state, 'unavailable')
})

test('signed out, files and memory are BLOCKED with something the visitor can do', () => {
  const out: PlatformCapabilitySnapshot = { ...STAGING, signedIn: false }
  assert.equal(platformCapabilityFact('documents', out).state, 'blocked')
  assert.match(platformCapabilityFact('documents', out).detail, /Sign in/)
  assert.equal(platformCapabilityFact('memory', out).state, 'blocked')
})

test('a registry that has not answered is NOT an empty registry', () => {
  const unknown: PlatformCapabilitySnapshot = { ...STAGING, registry: null }
  const fact = platformCapabilityFact('web-search', unknown)
  assert.equal(fact.state, 'unavailable')
  // It must not borrow a sentence it did not receive.
  assert.doesNotMatch(fact.detail, /not set up yet/)
})

test('vision reporting nothing produces no claim about vision', () => {
  const blind: PlatformCapabilitySnapshot = { ...STAGING, vision: null }
  const fact = platformCapabilityFact('images', blind)
  assert.equal(fact.state, 'unavailable')
  assert.match(fact.detail, /did not report its state/)
})

test('when vision IS approved it says yes, using the gate\'s own words', () => {
  const ready: PlatformCapabilitySnapshot = {
    ...STAGING,
    vision: { state: 'ready', message: 'Images are read with qwen2.5vl:7b.' },
  }
  const fact = platformCapabilityFact('images', ready)
  assert.equal(fact.state, 'available')
  assert.equal(fact.detail, 'Images are read with qwen2.5vl:7b.')
})

test('nothing asked produces nothing rendered', () => {
  assert.equal(renderPlatformCapabilities([]), '')
})

test('every rendered detail came from the snapshot or this module — never generated', () => {
  // The engine's sentences must appear verbatim, not paraphrased.
  const text = platformCapabilityAnswer(['web-search', 'email', 'images', 'audio'], STAGING).text
  assert.ok(text.includes('Web search is not set up yet.'))
  assert.ok(text.includes('Email is not set up yet.'))
  assert.ok(text.includes(STAGING.vision!.message))
  assert.ok(text.includes(STAGING.speech!.reason!))
})
