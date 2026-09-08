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
import { INFRASTRUCTURE_VOCABULARY, allStatusLabels, statusLabelFor } from '@/state/turnStatus'
import type { Message } from '@/data/types'

/**
 * The exact sentence the Brain sends on a cold model.
 *
 * It is kept here as the thing that must NEVER be renderable, not as an input.
 * The component no longer accepts Brain prose at all — see `turnStatus.ts`.
 */
const COLD_START =
  'Loading the language model — the first answer after a pause takes longer to start.'

/** What the product actually says for that same condition. Product voice. */
const PRODUCT_LABEL = statusLabelFor('loading_model') ?? ''

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

/** The container's own class list — the first element in a render. */
const rootClass = (html: string): string => classValues(html)[0] ?? ''

/**
 * The visual grammar of an assistant message, named explicitly.
 *
 * Acceptance is about what the user PERCEIVES, so these are asserted by name
 * rather than only by comparison: an avatar beside a bordered, rounded,
 * shadowed card is what "MigraPilot said this" looks like, and the progress
 * surface must have none of it.
 */
const MESSAGE_GRAMMAR = [
  { name: 'a card border', pattern: /\bborder\b/ },
  { name: 'a card shadow', pattern: /shadow-/ },
  { name: 'a bubble radius', pattern: /rounded-(?:2xl|xl|tl-md|br-md)/ },
  { name: 'a raised message surface', pattern: /bg-raised/ },
]

/* ------------------------------------------------------------------ *
 * The regression itself
 * ------------------------------------------------------------------ */

test('the progress surface has NONE of the assistant message grammar', () => {
  /*
   * FAILED ACCEPTANCE TWICE. First the sentence sat in the assistant bubble;
   * then the wordless case still rendered the avatar and the bubble, so a cold
   * start still showed MigraPilot's mark beside a bordered card with dots in
   * it. Both were defensible as "not a Message" and both looked like one.
   *
   * Asserted for BOTH the detailed and wordless renders, because the second
   * failure was entirely in the branch the first fix left alone.
   */
  for (const [label, html] of [
    ['with a status label', render(createElement(TypingIndicator, { label: PRODUCT_LABEL }))],
    ['with no label at all', render(createElement(TypingIndicator, {}))],
  ]) {
    assert.doesNotMatch(html, /<img/, `${label}: the progress surface carries the assistant avatar`)
    const root = rootClass(html)
    for (const { name, pattern } of MESSAGE_GRAMMAR) {
      assert.ok(
        !pattern.test(root),
        `${label}: the progress container has ${name} — that is message chrome (class="${root}")`,
      )
    }
  }
})

test('the progress surface offers none of a message’s controls', () => {
  for (const html of [
    render(createElement(TypingIndicator, { label: PRODUCT_LABEL })),
    render(createElement(TypingIndicator, {})),
  ]) {
    assert.doesNotMatch(html, /<button/, 'no Listen, copy or feedback on transient state')
    // A timestamp is the other thing that says "this was said at a moment".
    assert.doesNotMatch(html, /\d{1,2}:\d{2}/, 'no timestamp on transient state')
  }
})

test('there is ONE presentation, so no branch can quietly keep the old chrome', () => {
  // The second acceptance failure existed because there were two branches and
  // only one was fixed. Structure, not vigilance, is what prevents a third.
  const withLabel = rootClass(render(createElement(TypingIndicator, { label: PRODUCT_LABEL })))
  const without = rootClass(render(createElement(TypingIndicator, {})))
  assert.equal(withLabel, without, 'the progress container must not change shape with its content')
})

test('the cold-start line does NOT render in the assistant bubble', () => {
  const progress = render(createElement(TypingIndicator, { label: PRODUCT_LABEL }))
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
  const progress = render(createElement(TypingIndicator, { label: PRODUCT_LABEL }))
  const message = render(createElement(MessageView, { message: answer('A real answer.') }))

  assert.match(message, /<img/, 'an assistant message is expected to carry the brand mark')
  assert.doesNotMatch(
    progress,
    /<img/,
    'the progress surface must not wear the assistant’s avatar — that is what made it read as an answer',
  )
})

test('the cold-start line is announced as status, not as content', () => {
  const progress = render(createElement(TypingIndicator, { label: PRODUCT_LABEL }))
  assert.match(progress, /role="status"/, 'transient state must be a status region')
  assert.match(progress, /aria-live="polite"/)

  const message = render(createElement(MessageView, { message: answer('A real answer.') }))
  assert.doesNotMatch(
    message,
    /role="status"/,
    'a real answer must not be announced as status — the two must stay distinguishable',
  )
})

test('the status label is the only text in the progress surface', () => {
  const progress = render(createElement(TypingIndicator, { label: PRODUCT_LABEL }))
  assert.equal(textOf(progress), PRODUCT_LABEL)
})

test('the wordless indicator stays wordless', () => {
  // Putting a sentence into a surface that has no words is how this began.
  const dots = render(createElement(TypingIndicator, {}))
  assert.equal(textOf(dots), '', 'the dots-only state must never carry words')
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

/* ------------------------------------------------------------------ *
 * 🚨 THE PRODUCTION REGRESSION: infrastructure speaking to the user
 *
 * The suite above proved the indicator does not LOOK like a message, and that
 * held. Production then showed a user this, mid-conversation, on an
 * image-understanding turn:
 *
 *   "Loading the language model — the first answer after a pause takes longer
 *    to start."
 *
 * Correct shape, wrong voice. Nothing here asked what the words WERE, so the
 * suite passed while infrastructure described itself to a person who had asked
 * about a spreadsheet. These tests ask that question.
 * ------------------------------------------------------------------ */

/** Every stage the Brain emits today, text lane and image lane. */
const BRAIN_STAGES = ['loading_model', 'submitting', 'queued', 'generating', 'downloading']

/** The sentences the Brain authors for them. Copied from `aiRoutes.ts`. */
const BRAIN_PROSE = [
  'Loading the language model — the first answer after a pause takes longer to start.',
  'Sending your prompt to the image pipeline',
  'Queued in the image pipeline',
  'Waiting behind 3 job(s)',
  'Loading the image model and generating',
  'Retrieving the finished image',
]

test('no producible status label contains infrastructure vocabulary', () => {
  /*
   * The mutation gate. Mapping any stage back to the Brain's wording — or to
   * anything else about models, pipelines or checkpoints — fails here.
   *
   * The vocabulary list is imported from the seam rather than restated, so the
   * rule and its guard cannot drift apart.
   */
  for (const label of allStatusLabels()) {
    for (const word of INFRASTRUCTURE_VOCABULARY) {
      assert.ok(
        !label.toLowerCase().includes(word),
        `status copy "${label}" contains infrastructure vocabulary "${word}".\n` +
          '  Status copy describes the USER’S work, never the machinery doing it.',
      )
    }
  }
})

test('every Brain stage renders product copy, never the Brain’s own sentence', () => {
  // Both lanes: the text lane (loading_model — the production defect) and the
  // image lane, which shipped the same shape and would have failed the same way.
  for (const stage of BRAIN_STAGES) {
    const label = statusLabelFor(stage)
    assert.ok(label, `stage "${stage}" has no product copy — it would render bare`)
    const html = render(createElement(TypingIndicator, { label }))
    for (const prose of BRAIN_PROSE) {
      assert.ok(
        !html.includes(prose),
        `stage "${stage}" rendered the Brain's own sentence: "${prose}"`,
      )
    }
  }
})

test('the exact production sentence cannot be produced by any stage', () => {
  // Named on its own because this is the string a user actually saw.
  for (const stage of [...BRAIN_STAGES, 'unknown_future_stage', '', 'vision', 'cold_start']) {
    assert.notEqual(statusLabelFor(stage), COLD_START)
  }
})

test('an unknown stage renders motion with NO claim', () => {
  /*
   * A stage nobody has mapped must not be narrated. Inventing a description
   * for an unrecognised condition is the fabricated-progress failure this
   * codebase refuses elsewhere — and it is also how a future Brain stage would
   * smuggle new wording onto the screen.
   */
  assert.equal(statusLabelFor('a_stage_added_next_month'), null)
  assert.equal(statusLabelFor(undefined), null)
  assert.equal(statusLabelFor(42), null)
  const bare = render(createElement(TypingIndicator, {}))
  assert.equal(textOf(bare), '')
})

test('the stream boundary does not carry the Brain’s prose to the client', () => {
  /*
   * A WIRING CHECK at the seam, and only that.
   *
   * The rendering claims above are proven by rendering. What source text CAN
   * answer is whether `detail` is still read off the frame and forwarded — the
   * single line that made every rendering guard irrelevant, because the prose
   * arrived already-formed and the UI merely displayed what it was given.
   */
  const route = readFileSync(join(process.cwd(), 'src/app/api/chat/stream/route.ts'), 'utf8')
  const stageCase = route.slice(route.indexOf("case 'stage':"), route.indexOf("case 'image':"))
  assert.ok(stageCase.length > 0, 'the stage case could not be located')
  assert.doesNotMatch(
    stageCase,
    /emit\('stage',\s*\{[^}]*detail/,
    'the stage frame forwards `detail` again — Brain prose is reaching the browser',
  )
})

test('progress never coexists with an answer that has arrived', () => {
  // "No duplicate indicator" stated as the property rather than the symptom:
  // once the answer has content, the indicator is gone, so two surfaces
  // describing one turn cannot be on screen together.
  const withAnswer = showsTurnProgress({
    messages: [question('what is in the sheet?'), answer('Revenue totals 391.')],
    pending: true,
  })
  assert.equal(withAnswer, false)
})
