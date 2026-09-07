/**
 * Cold starts are PROGRESS, never an answer — proven by RENDERING, not by
 * reading the source file.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SUITE WAS REWRITTEN
 *
 * The first version of this file matched `ChatProvider.tsx` and `ChatPage.tsx`
 * as TEXT: `assert.doesNotMatch(provider, /paint\(detail\)/)` and friends. Every
 * assertion passed. The defect was live on screen the whole time.
 *
 * It passed because it was checking the wrong claim. It proved the string was
 * not written into the message DATA — which was true — while the string was
 * being rendered inside `LogoMark` and the assistant's own bubble classes, so
 * what a user actually saw was MigraPilot's avatar, MigraPilot's bubble, and a
 * sentence in it. A source file cannot answer "what does this look like"; only
 * rendering it can. See [[feedback_no_keyword_proxy_for_semantic_claims]] —
 * this is the same defect class, in a test rather than a metric.
 *
 * So: everything here renders real components and asserts on real markup.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MessageView, TypingIndicator } from '@/components/chat/Message'
import { showsTurnProgress } from '@/state/turnProgress'
import type { Message } from '@/data/types'

/** The exact sentence the Brain sends on a cold model. */
const COLD_START =
  'Loading the language model — the first answer after a pause takes longer to start.'

const answer = (text: string): Message => ({
  id: 'a1',
  role: 'assistant',
  time: '10:02',
  blocks: [{ type: 'paragraph', text }],
})

const question = (text: string): Message => ({ id: 'u1', role: 'user', time: '10:01', text })

const render = (element: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(element)

/** Every `class="…"` value in some markup, as written. */
const classValues = (html: string): string[] =>
  [...html.matchAll(/class="([^"]*)"/g)].map((match) => match[1]!)

/** Visible text, with tags removed — what a reader would actually read. */
const textOf = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&#x27;|&quot;|&amp;/g, '')
    .trim()

/* ------------------------------------------------------------------ *
 * The regression itself
 * ------------------------------------------------------------------ */

test('the cold-start line does NOT render in the assistant bubble', () => {
  const progress = render(createElement(TypingIndicator, { detail: COLD_START }))
  const message = render(createElement(MessageView, { message: answer('A real answer.') }))

  /*
   * SELF-CALIBRATING. The bubble's class list is read off an actual rendered
   * assistant message rather than written down here, so this keeps working when
   * the design changes and cannot be satisfied by renaming a class.
   *
   * This is the assertion that fails if the old markup is restored: the two
   * renders shared `flex items-center gap-2.5 rounded-2xl rounded-tl-md border
   * border-hairline bg-raised … shadow-card` character for character.
   */
  const messageClasses = new Set(classValues(message))
  for (const value of classValues(progress)) {
    assert.ok(
      !messageClasses.has(value),
      `the progress surface reuses an assistant-message container: "${value}"\n` +
        '  Runtime state rendered in message chrome IS a message to the reader.',
    )
  }
})

test('the cold-start line carries no assistant identity — no avatar', () => {
  const progress = render(createElement(TypingIndicator, { detail: COLD_START }))
  const message = render(createElement(MessageView, { message: answer('A real answer.') }))

  assert.match(message, /<img/, 'an assistant message is expected to carry the brand mark')
  assert.doesNotMatch(
    progress,
    /<img/,
    'the progress surface must not wear the assistant’s avatar — that is what made it read as an answer',
  )
})

test('the cold-start line is announced as status, not as content', () => {
  const progress = render(createElement(TypingIndicator, { detail: COLD_START }))
  assert.match(progress, /role="status"/, 'transient state must be a status region')
  assert.match(progress, /aria-live="polite"/)

  const message = render(createElement(MessageView, { message: answer('A real answer.') }))
  assert.doesNotMatch(
    message,
    /role="status"/,
    'a real answer must not be announced as status — the two must stay distinguishable',
  )
})

test('the cold-start detail is the only text in the progress surface', () => {
  const progress = render(createElement(TypingIndicator, { detail: COLD_START }))
  assert.equal(textOf(progress), COLD_START)
})

test('the wordless indicator stays wordless', () => {
  // Putting a sentence back into the bubble branch is exactly how this defect
  // was built the first time.
  const dots = render(createElement(TypingIndicator, {}))
  assert.equal(textOf(dots), '', 'the three-dot indicator must never carry words')
})

/* ------------------------------------------------------------------ *
 * Exactly one surface, and it goes away
 * ------------------------------------------------------------------ */

test('progress shows while the turn has produced nothing', () => {
  assert.equal(showsTurnProgress({ messages: [question('why?')], pending: true }), true)
})

test('progress STOPS the moment the answer starts arriving', () => {
  // The streaming bubble is now the progress. A second surface under it is the
  // duplicate floating indicator.
  assert.equal(
    showsTurnProgress({ messages: [question('why?'), answer('Because')], pending: true }),
    false,
  )
})

test('an empty assistant bubble does not count as an answer arriving', () => {
  // A first token can be an empty delta. Hiding progress there would leave the
  // user with no indication at all — the original complaint, inverted.
  const empty: Message = { id: 'a1', role: 'assistant', time: '10:02', blocks: [] }
  assert.equal(showsTurnProgress({ messages: [question('why?'), empty], pending: true }), true)
})

test('a generated picture counts as the answer arriving', () => {
  const picture: Message = { id: 'a1', role: 'assistant', time: '10:02', blocks: [], images: ['img_1'] }
  assert.equal(showsTurnProgress({ messages: [question('draw'), picture], pending: true }), false)
})

test('nothing renders when no turn is running', () => {
  assert.equal(showsTurnProgress({ messages: [question('why?'), answer('Because')], pending: false }), false)
  assert.equal(showsTurnProgress({ messages: [], pending: false }), false)
})

test('the page actually asks the rule, rather than rendering on `pending`', () => {
  /*
   * A WIRING CHECK, AND ONLY A WIRING CHECK.
   *
   * Rendering ChatPage here would mean standing up routing and three providers;
   * the honest guard at that price is "does the page call the rule". That is a
   * question about the source text, and matching source text answers it.
   *
   * What matching source text CANNOT answer is what the result looks like —
   * which is the mistake this file used to make. The live harness
   * (`scripts/verify-cold-start.mjs`) is what proves the wiring against a real
   * cold start; this only fails fast when someone reverts the call.
   */
  const chatPage = readFileSync(join(process.cwd(), 'src/screens/ChatPage.tsx'), 'utf8')
  assert.match(chatPage, /showsTurnProgress\(\{ messages, pending \}\) && \(/)
  assert.doesNotMatch(
    chatPage,
    /\{pending && \(\s*<TypingIndicator/,
    'rendering on `pending` alone leaves the indicator running under the answer',
  )
})

/* ------------------------------------------------------------------ *
 * A failure to load is a notice, not an authored reply
 * ------------------------------------------------------------------ */

test('a load failure renders as a system notice, not as the assistant speaking', () => {
  const failure: Message = {
    id: 'a1',
    role: 'assistant',
    time: '10:02',
    error: true,
    blocks: [{ type: 'paragraph', text: 'The language model could not be loaded.' }],
  }
  const notice = render(createElement(MessageView, { message: failure }))
  const spoken = render(createElement(MessageView, { message: answer('A real answer.') }))

  assert.match(notice, /role="status"/, 'a failure is status, not content')
  assert.doesNotMatch(notice, /<img/, 'a failure must not wear the assistant’s avatar')

  /*
   * AND IT CARRIES NONE OF THE ANSWER'S AFFORDANCES. Listen, copy and the
   * feedback thumbs all say "this is something MigraPilot said" — offering them
   * on an infrastructure failure invites the user to have it read aloud, which
   * is the clearest possible statement that the product thinks it authored it.
   */
  assert.match(spoken, /<button/, 'a real answer is expected to offer its controls')
  assert.doesNotMatch(notice, /<button/, 'a failure must not offer Listen, copy or feedback')
})
