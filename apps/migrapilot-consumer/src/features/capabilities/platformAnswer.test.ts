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
  classifyCapabilityIntent,
  platformCapabilityAnswer,
  platformCapabilityFact,
  platformCapabilityTopics,
  renderPlatformCapabilities,
  type PlatformCapabilitySnapshot,
  type PlatformTopic,
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

/* ── 🚨 THE TWO OWNER-FAILING PHRASINGS, VERBATIM ───────────────────────── *
 *
 * Staging brain-f9ad3c0c / consumer-10796d03, owner validation 2026-09-12.
 * Both went to the model. Both were invented. Neither is exotic.
 */

test('OWNER 1: "Will you remember this conversation after the service restarts?"', () => {
  // The model said: "I do not maintain a persistent memory of individual
  // conversations between service restarts … each conversation is ephemeral."
  const prompt = 'Will you remember this conversation after the service restarts?'
  const intent = classifyCapabilityIntent(prompt)
  assert.equal(intent.confidence, 'high', intent.reason)
  assert.deepEqual(intent.topics, ['memory'])
  const text = answer(prompt)
  assert.match(text, /Remembering earlier conversations — yes\./)
  assert.ok(/including after a restart/.test(text))
  assert.doesNotMatch(text, /ephemeral/i)
})

test('OWNER 2: "What audio or transcription support is currently available?"', () => {
  // The model invented an entire audio stack: "Audio Playback — MP3, WAV,
  // AAC. Text-to-Speech. Speech-to-Text. Transcription Services."
  const prompt = 'What audio or transcription support is currently available?'
  const intent = classifyCapabilityIntent(prompt)
  assert.equal(intent.confidence, 'high', intent.reason)
  assert.deepEqual(intent.topics, ['audio'])
  // It never says "you" — the subject is implicit in "support is available".
  assert.equal(intent.subject, 'self-implicit')
  const text = answer(prompt)
  assert.match(text, /Transcribing audio — no\./)
  assert.ok(text.includes('MIGRAPILOT_SPEECH_RUNTIME_URL'))
  assert.doesNotMatch(text, /MP3|Text-to-Speech|third-party/i)
})

/* ── the paraphrase matrix ──────────────────────────────────────────────── *
 *
 * 🚨 PARAPHRASE COVERAGE, NOT EXACT-STRING COVERAGE. None of these appear
 * anywhere in the classifier. They exist to prove the three axes generalise:
 * each row is one topic asked across the question families — ability,
 * availability, persistence, current-state, configuration, negative/indirect.
 */

const MATRIX: ReadonlyArray<[PlatformTopic, readonly string[]]> = [
  ['memory', [
    'Will you remember this conversation after the service restarts?',
    'Do you remember previous conversations after a restart?',
    'Is conversation history retained between sessions?',
    'Are my chats saved anywhere?',
    'Does this service keep my earlier conversations?',
    'Will my past chats persist?',
    "You don't remember anything from earlier sessions, do you?",
    'Is chat history stored on this deployment?',
  ]],
  ['audio', [
    'What audio or transcription support is currently available?',
    'Is transcription enabled?',
    'Can you transcribe a voice note?',
    'Is there support for speech-to-text?',
    'Does the microphone work here?',
    'Is dictation configured on this server?',
    "Why can't you transcribe my recording?",
  ]],
  ['images', [
    'Is vision enabled right now?',
    'Are screenshots supported?',
    'Do you have image understanding?',
    'Is OCR available on this deployment?',
    'Can this assistant read a diagram?',
  ]],
  ['documents', [
    'Are PDFs supported?',
    'What file types do you support?',
    'Is there support for spreadsheets?',
    'Do you handle docx attachments?',
    'Can this app read a CSV?',
  ]],
  ['web-search', [
    'Is web search configured?',
    'Do you have internet access?',
    'Is browsing the web enabled here?',
    'Can you look things up online?',
    "You can't search the internet, right?",
  ]],
  ['email', [
    'Is Gmail connected?',
    'Do you have access to my inbox?',
    'Is email set up on this deployment?',
    'Can you read my mailbox?',
  ]],
  ['code-execution', [
    'Is code execution enabled?',
    'Can you run a script for me?',
    'Is there a sandbox available?',
    'Do you have terminal access?',
  ]],
  ['files', [
    'Can you open a file from my machine?',
    'Do you have access to my local files?',
    'Is the file library available?',
  ]],
  ['image-generation', [
    'Is image generation configured?',
    'Can you generate an image?',
    'Is text-to-image supported here?',
  ]],
]

for (const [topic, prompts] of MATRIX) {
  for (const prompt of prompts) {
    test(`paraphrase → ${topic}: ${prompt}`, () => {
      const intent = classifyCapabilityIntent(prompt)
      assert.equal(intent.confidence, 'high', `not classified: ${intent.reason}`)
      assert.ok(
        intent.topics.includes(topic),
        `expected ${topic}, got [${intent.topics.join(', ')}] — ${intent.reason}`,
      )
      // And it must actually produce product-owned text, not just classify.
      assert.ok(answer(prompt).length > 0, 'classified but rendered nothing')
    })
  }
}

test('an overview survives paraphrase too', () => {
  for (const prompt of [
    'What can you actually do for me right now?',
    'What are your capabilities?',
    'What are you able to do?',
    'What features are there?',
    'What do you support?',
    'What can MigraPilot do?',
  ]) {
    assert.deepEqual(platformCapabilityTopics(prompt), ['overview'], `missed overview: ${prompt}`)
  }
})

/* ── 🚨 THE NEGATIVES THE OWNER NAMED ───────────────────────────────────── *
 *
 * A false positive answers a real question with a capability table, which is a
 * worse failure than the one being fixed. These name capability nouns and are
 * ordinary knowledge.
 */

test('"How does computer memory work?" must remain ordinary knowledge', () => {
  const intent = classifyCapabilityIntent('How does computer memory work?')
  assert.deepEqual(intent.topics, [])
  assert.equal(intent.confidence, 'none')
})

test('"What audio format is best for podcasts?" must remain ordinary knowledge', () => {
  const intent = classifyCapabilityIntent('What audio format is best for podcasts?')
  assert.deepEqual(intent.topics, [])
  assert.equal(intent.confidence, 'none')
})

test('capability nouns in ordinary questions do not hijack the turn', () => {
  for (const prompt of [
    'How does computer memory work?',
    'What audio format is best for podcasts?',
    'Explain how vision transformers process an image.',
    'What is the difference between RAM and disk memory?',
    'Write me a function that transcribes audio.',
    'Can you write a Python script to parse this CSV?',
    'Tell me about the history of email.',
    'How do I run a shell command in Docker?',
    'What is a PDF?',
    'Which search engine is best for privacy?',
    'My email to the supplier bounced — why might that happen?',
    'Summarise this document for me.',
    'Can you write a unit test for this component?',
    'How does web search work under the hood?',
    'Explain memory management in Rust.',
    'What is the best microphone for recording a podcast?',
  ]) {
    const intent = classifyCapabilityIntent(prompt)
    assert.deepEqual(intent.topics, [], `hijacked: "${prompt}" (${intent.reason})`)
  }
})

/* ── low confidence must not fabricate ──────────────────────────────────── */

test('a product question with no resolvable capability is LOW confidence, never a guess', () => {
  const intent = classifyCapabilityIntent('Can you book me a flight to Port-au-Prince?')
  assert.equal(intent.subject, 'self-explicit')
  assert.equal(intent.confidence, 'low')
  // 🚨 The whole point: it does NOT pick a topic to have something to say.
  assert.deepEqual(intent.topics, [])
})

test('a registry that did not answer says NOT VERIFIED — it does not claim absence', () => {
  const unknown: PlatformCapabilitySnapshot = { ...STAGING, registry: null }
  const fact = platformCapabilityFact('web-search', unknown)
  assert.match(fact.detail, /did not answer/)
  assert.match(fact.detail, /not verified/)
  // It must not assert "not offered here" from no evidence.
  assert.doesNotMatch(fact.detail, /not offered here/)
  assert.match(renderPlatformCapabilities([fact]), /Searching the web — not verified\./)
})

test('an empty registry IS an answer — that capability is genuinely not offered', () => {
  const empty: PlatformCapabilitySnapshot = { ...STAGING, registry: [] }
  const fact = platformCapabilityFact('web-search', empty)
  assert.equal(fact.state, 'unavailable')
  assert.match(fact.detail, /not offered here/)
})

/* ── the classifier reports why, so a miss is diagnosable ───────────────── */

test('every intent carries a reason', () => {
  for (const prompt of [
    'What audio format is best for podcasts?',
    'Will you remember this conversation after the service restarts?',
    'Can you book me a flight?',
    'Hello',
  ]) {
    assert.ok(classifyCapabilityIntent(prompt).reason.length > 0, prompt)
  }
})

/* ── the two corpora ────────────────────────────────────────────────────── *
 *
 * 🚨 THESE ARE THE ACCEPTANCE SET, NOT EXAMPLES. Both directions of the
 * failure are represented, because both are real:
 *
 *   a HIJACK answers a genuine question with a capability table, in the
 *   product's own authoritative voice — worse than the bug being fixed
 *   a MISS  hands a product-capability question to a general model, which is
 *   the bug being fixed
 *
 * Nothing below appears anywhere in the classifier.
 */

const ORDINARY_CORPUS: readonly string[] = [
  'Write a SQL query that joins orders and customers.',
  'Refactor this component to use hooks.',
  'What does this stack trace mean?',
  'Draft an email to my landlord about the broken heater.',
  'Summarise the attached contract.',
  'Translate this paragraph into Haitian Creole.',
  'Explain the difference between TCP and UDP.',
  'How do I compress an image without losing quality?',
  'What is the best way to back up a Postgres database?',
  'My terminal says permission denied when I run the script.',
  'Give me a regex for validating an email address.',
  'Why is my microphone picking up background noise?',
  'Recommend a podcast about economics.',
  'How much memory does a Python list use?',
  'Search this document for the payment terms.',
  'What are the main features of PostgreSQL 16?',
  'Review my code for bugs.',
  'Is it possible to run Docker on Windows?',
  'Are images in HTML cached by the browser?',
  'Tell me a joke about email.',
  'Does the microphone on the iPhone 15 support stereo recording?',
  'What are the limits of a free Cloudflare plan?',
  'Has the deployment finished yet?',
  'What is the maximum size of a Postgres row?',
  'Is the invoice approved yet?',
]

const PRODUCT_CORPUS: readonly string[] = [
  'Do you have web search?',
  'Is vision approved yet?',
  'Are attachments supported on this deployment?',
  'Will my conversation survive a restart?',
  'Is speech-to-text configured?',
  'Do you keep a record of what we talked about last week?',
  'What are the limits on the files I can attach?',
  'Is your email integration connected?',
  'Can this assistant execute code?',
  'You cannot search the web, correct?',
]

test('CORPUS: no ordinary question is answered with a capability table', () => {
  const hijacked = ORDINARY_CORPUS
    .map((p) => ({ p, i: classifyCapabilityIntent(p) }))
    .filter(({ i }) => i.topics.length > 0)
    .map(({ p, i }) => `${JSON.stringify(p)} → ${i.topics.join(', ')} (${i.reason})`)
  assert.deepEqual(hijacked, [], `hijacked ${hijacked.length} ordinary question(s)`)
})

test('CORPUS: every product-capability question resolves from capability state', () => {
  const missed = PRODUCT_CORPUS
    .map((p) => ({ p, i: classifyCapabilityIntent(p) }))
    .filter(({ i }) => i.topics.length === 0)
    .map(({ p, i }) => `${JSON.stringify(p)} → ${i.confidence} (${i.reason})`)
  assert.deepEqual(missed, [], `missed ${missed.length} product question(s)`)
})

test('CORPUS: every product question renders product-owned text, not a stub', () => {
  for (const prompt of PRODUCT_CORPUS) {
    const text = answer(prompt)
    assert.ok(text.length > 0, `rendered nothing for ${JSON.stringify(prompt)}`)
    // Product-owned text always names the capability and states a verdict.
    assert.match(text, / — (yes|no|not right now|not verified)\./, prompt)
  }
})

/* ── limits come from the authority, never from this file ───────────────── */

test('"what are the limits" answers with the limit that is actually enforced', () => {
  const withLimits: PlatformCapabilitySnapshot = {
    ...STAGING,
    limits: { maxFileBytes: 50_000_000, maxFiles: 2000, maxExtractBytes: 25_000_000 },
  }
  assert.deepEqual(platformCapabilityTopics('What are the limits on the files I can attach?'), ['documents'])
  const doc = platformCapabilityFact('documents', withLimits).detail
  assert.match(doc, /Up to 50 MB per file, and text is read from the first 25 MB of it\./)
  const files = platformCapabilityFact('files', withLimits).detail
  assert.match(files, /You can keep up to 2,000 files\./)
})

test('no limits supplied means no sentence invented about limits', () => {
  // 🚨 The failure mode this replaces was a true statement that was not an
  // answer. Its replacement must not become a made-up number.
  const doc = platformCapabilityFact('documents', STAGING).detail
  assert.doesNotMatch(doc, /Up to .* per file/)
  assert.doesNotMatch(platformCapabilityFact('files', STAGING).detail, /You can keep up to/)
})
