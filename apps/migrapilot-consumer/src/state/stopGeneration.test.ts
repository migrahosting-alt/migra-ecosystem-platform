/**
 * Stopping a turn.
 *
 * THE DEFECT THIS CLOSES. A running turn could not be stopped. The server was
 * always right about cancellation — dropping the request runs the stream
 * route's `cancel()`, which returns the Brain generator and stops the model —
 * but the browser never aborted anything. The only way out of a turn was to
 * close the tab, and a graphics card kept producing an answer nobody would read.
 *
 * TWO PROPERTIES ARE PROTECTED HERE, and they are not the same property:
 *
 *   1. Stop reaches the RIGHT turn. The conversation is renamed mid-turn, so a
 *      registry that cannot follow the rename would leave exactly the long turns
 *      unstoppable — the only ones anyone wants to stop.
 *   2. A stop is not reported as a fault. The abort and a dropped connection are
 *      the same event to `fetch`; telling them apart is what stops the product
 *      blaming itself for a button the user pressed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TurnRegistry, stoppedOutcome } from './turnControl'

// ── the registry: does Stop reach the request? ──────────────────────────────

test('stopping a conversation aborts the request that is streaming into it', () => {
  const turns = new TurnRegistry()
  const turn = turns.open('conv_a')

  assert.equal(turn.controller.signal.aborted, false, 'a fresh turn is not aborted')
  assert.equal(turns.stop('conv_a'), true, 'the stop found a running turn')
  assert.equal(turn.controller.signal.aborted, true, 'the request is aborted')
  assert.equal(turn.stopped, true, 'and it is marked as the user stopping it')
})

test('THE RENAME: a turn opened under the optimistic id is stopped by its durable one', () => {
  /*
   * The exact sequence in the product: a new chat is sent under `chat-…`, the
   * Brain names it a moment later, the page follows that name — and Stop is
   * pressed against the name the page is showing.
   */
  const turns = new TurnRegistry()
  const turn = turns.open('chat-1786')

  turns.rekey('chat-1786', 'conv_real')

  assert.equal(turns.stop('conv_real'), true, 'the durable id finds the turn')
  assert.equal(turn.controller.signal.aborted, true)
})

test('and the id it was opened under stops naming it, so a stale control cannot fire', () => {
  const turns = new TurnRegistry()
  turns.open('chat-1786')
  turns.rekey('chat-1786', 'conv_real')

  assert.equal(turns.stop('chat-1786'), false, 'the optimistic id no longer matches')
})

test('a rename to the same id, or of a conversation with nothing running, changes nothing', () => {
  const turns = new TurnRegistry()
  const turn = turns.open('conv_a')

  turns.rekey('conv_a', 'conv_a')
  turns.rekey('conv_absent', 'conv_b')

  assert.equal(turns.stop('conv_a'), true)
  assert.equal(turn.controller.signal.aborted, true)
})

test('a stop names ONE conversation — another thread streaming beside it is untouched', () => {
  const turns = new TurnRegistry()
  const mine = turns.open('conv_a')
  const other = turns.open('conv_b')

  turns.stop('conv_a')

  assert.equal(mine.controller.signal.aborted, true)
  assert.equal(other.controller.signal.aborted, false, 'a different conversation kept streaming')
  assert.equal(other.stopped, false)
})

test('stopping a conversation with nothing running says so rather than pretending', () => {
  const turns = new TurnRegistry()
  assert.equal(turns.stop('conv_none'), false)
})

test('A DROPPED CONNECTION IS NOT A STOP', () => {
  /*
   * The distinction the whole error path depends on. An abort raised by anything
   * other than the user — a network drop, a navigation — must leave `stopped`
   * false, or the browser reports a real outage as the user's own decision and
   * says nothing went wrong.
   */
  const turns = new TurnRegistry()
  const turn = turns.open('conv_a')

  turn.controller.abort()

  assert.equal(turn.controller.signal.aborted, true)
  assert.equal(turn.stopped, false, 'nobody stopped this turn')
})

test('a finished turn is retired by identity, never by conversation', () => {
  /*
   * Two turns on one conversation is not reachable from the UI — the send
   * control becomes Stop while one runs — but a registry that deregistered by id
   * would let the FIRST turn to finish take the second one's handle with it,
   * leaving a running turn nothing could reach.
   */
  const turns = new TurnRegistry()
  const first = turns.open('conv_a')
  const second = turns.open('conv_a')

  turns.close(first)

  assert.equal(turns.isRunning('conv_a'), true, 'the second turn is still registered')
  assert.equal(turns.stop('conv_a'), true)
  assert.equal(second.controller.signal.aborted, true, 'and it is the one that gets stopped')
})

test('stopping a conversation stops EVERY turn open on it', () => {
  const turns = new TurnRegistry()
  const first = turns.open('conv_a')
  const second = turns.open('conv_a')

  turns.stop('conv_a')

  assert.equal(first.controller.signal.aborted, true)
  assert.equal(second.controller.signal.aborted, true)
})

test('a closed turn leaves nothing running behind it', () => {
  const turns = new TurnRegistry()
  const turn = turns.open('conv_a')
  turns.close(turn)

  assert.equal(turns.isRunning('conv_a'), false)
  assert.equal(turns.stop('conv_a'), false)
})

// ── what the user is left holding ───────────────────────────────────────────

test('text the user already read is KEPT, not deleted out from under them', () => {
  assert.deepEqual(stoppedOutcome({ streamed: 'The first half of an answer', generated: 0 }), {
    keep: true,
  })
})

test('A PICTURE IS AN ANSWER — an image-only turn is kept too', () => {
  /*
   * The same rule as the delivery path, and the same defect if it is missed:
   * generation produces no text, so judging by `streamed` alone would discard a
   * picture the user watched arrive and had every right to stop after.
   */
  assert.deepEqual(stoppedOutcome({ streamed: '', generated: 1 }), { keep: true })
})

test('a turn stopped before anything arrived keeps nothing, and says why', () => {
  const outcome = stoppedOutcome({ streamed: '   \n ', generated: 0 })
  assert.equal(outcome.keep, false)
  assert.ok(outcome.keep === false && /stopped/i.test(outcome.notice), 'it names the stop')
})

test('the empty-turn notice never reports a fault the user caused', () => {
  const outcome = stoppedOutcome({ streamed: '', generated: 0 })
  assert.ok(outcome.keep === false)
  const notice = outcome.keep === false ? outcome.notice : ''
  for (const blame of [/could not be reached/i, /failed/i, /error/i, /try again/i]) {
    assert.doesNotMatch(notice, blame, `a stop must not read as a failure: ${notice}`)
  }
})

// ── the wiring: comments may not satisfy any assertion below ────────────────

const src = (rel: string): string => {
  const raw = readFileSync(join(process.cwd(), 'src', ...rel.split('/')), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const provider = src('state/ChatProvider.tsx')
const composer = src('components/chat/Composer.tsx')
const chatPage = src('screens/ChatPage.tsx')
const message = src('components/chat/Message.tsx')

test('THE ABORT REACHES THE NETWORK — the stream request carries the turn signal', () => {
  /*
   * Without this the whole feature is theatre: the spinner would clear, the
   * button would flip back, and the Brain would keep generating an answer that
   * is still being paid for.
   */
  const request = provider.slice(provider.indexOf("fetch('/api/chat/stream'"))
  assert.match(
    request.slice(0, 1200),
    /signal:\s*inFlight\.controller\.signal/,
    'the streamed turn must be sent with the in-flight turn\'s abort signal',
  )
})

test('the turn is registered before the request, so Stop is never a dead control', () => {
  const body = provider.slice(provider.indexOf('const appendReply'))
  const opened = body.indexOf('turns.current.open(')
  const requested = body.indexOf("fetch('/api/chat/stream'")
  assert.ok(opened !== -1 && requested !== -1, 'both the registration and the request exist')
  assert.ok(opened < requested, 'the turn is stoppable before it is sent')
})

test('the running turn follows the Brain renaming the conversation', () => {
  const adopt = provider.slice(provider.indexOf('const adoptDurableId'))
  assert.match(
    adopt.slice(0, 700),
    /turns\.current\.rekey\(from, to\)/,
    'adopting the durable id must move the running turn with it',
  )
})

test('A STOP IS NOT REPORTED AS AN OUTAGE', () => {
  const caught = provider.slice(provider.indexOf('} catch {', provider.indexOf('const appendReply')))
  const stopBranch = caught.indexOf('inFlight.stopped')
  const unreachable = caught.indexOf('could not be reached')
  assert.ok(stopBranch !== -1, 'the stop is recognised')
  assert.ok(unreachable !== -1, 'the transport failure notice still exists')
  assert.ok(stopBranch < unreachable, 'and the stop is decided BEFORE anything is blamed')
})

test('a stopped turn ends the pending state, so no spinner outlives it', () => {
  const caught = provider.slice(provider.indexOf('} catch {', provider.indexOf('const appendReply')))
  const branch = caught.slice(caught.indexOf('inFlight.stopped'), caught.indexOf('discardPartial()\n      push('))
  assert.match(branch, /setPendingIn\(null\)/, 'pending is cleared')
  assert.match(branch, /setProgressIn\(null\)/, 'and so is the progress line')
})

test('the turn is deregistered however it ends', () => {
  const body = provider.slice(provider.indexOf('const appendReply'))
  const finallyBlock = body.slice(body.indexOf('} finally {'), body.indexOf('}, [router, applyServerQuota])'))
  assert.match(
    finallyBlock,
    /turns\.current\.close\(inFlight\)/,
    'a finished turn must not leave a Stop control pointed at a dead request',
  )
})

test('the composer offers Stop and Send in one slot, never both', () => {
  assert.equal((composer.match(/aria-label="Stop generating"/g) ?? []).length, 1)
  assert.equal((composer.match(/aria-label="Send message"/g) ?? []).length, 1)
  assert.match(composer, /\{stoppable \? \([\s\S]{0,900}aria-label="Stop generating"/)
  // The send control lives in the alternate branch — it cannot render beside a
  // running stream, which is what let a second turn be fired into one.
  assert.match(composer, /aria-label="Stop generating"[\s\S]{0,900}\) : \([\s\S]{0,400}aria-label="Send message"/)
})

test('STOP DOES NOT SEND A MESSAGE — measured, then guarded three ways', () => {
  /*
   * 🚨 THE REGRESSION THIS EXISTS FOR, found in a real browser and reproduced
   * deterministically: clicking Stop with anything typed in the composer POSTED
   * IT as a new turn. Two requests for one click — the turn being stopped, and
   * a turn the user never sent.
   *
   * `type="button"` was already there and did not save it. `onStop` aborts, the
   * rejection lands on the microtask checkpoint at the end of the click
   * handler, React clears `pending` and re-renders — and because both branches
   * render a `<button>` in the same position, React patched the CLICKED NODE
   * from `type="button"` to `type="submit"` before the browser ran the click's
   * default action.
   *
   * All three defences are asserted, because the one that was obvious is the
   * one that failed.
   */
  const stop = composer.slice(composer.indexOf('key="stop"') - 100, composer.indexOf('key="send"'))
  assert.match(stop, /type="button"/, 'a submit-typed Stop would send the text')
  assert.match(stop, /event\.preventDefault\(\)/, 'the click must not run its default action')
  assert.match(stop, /onStop\?\.\(\)/, 'and it must still stop the turn')
  // Distinct keys: React replaces the node instead of retyping the one that was
  // clicked. Same key on both branches is how the defect gets back in.
  assert.match(composer, /key="stop"/)
  assert.match(composer, /key="send"/)
  const preventsFirst = stop.indexOf('event.preventDefault()') < stop.indexOf('onStop?.()')
  assert.ok(preventsFirst, 'the default action is cancelled before anything can re-render')
})

test('ENTER OBEYS THE SAME RULE AS THE BUTTON', () => {
  // Swapping only the button would leave the defect intact: most turns are sent
  // with the keyboard.
  const submit = composer.slice(composer.indexOf('const submit = ('))
  assert.match(submit.slice(0, 700), /if \(stoppable\) return/)
})

test('opting in requires BOTH a streaming flag and a way to stop', () => {
  assert.match(composer, /const stoppable = streaming && Boolean\(onStop\)/)
})

test('the chat page arms the control from the same state as the typing indicator', () => {
  assert.match(chatPage, /streaming=\{pending\}/)
  assert.match(chatPage, /onStop=\{\(\) => stopTurn\(conversation\.id\)\}/)
  assert.match(chatPage, /pending && \(\s*<TypingIndicator/, 'and that state still drives the spinner')
})

test('a stopped answer is labelled as kept-but-not-saved', () => {
  assert.match(message, /message\.stopped && \(/, 'the marker renders')
  const marker = message.slice(message.indexOf('message.stopped && ('))
  assert.match(marker.slice(0, 900), /You stopped this answer/)
  assert.match(marker.slice(0, 900), /not saved/, 'it must not imply a persistence that did not happen')
})

test('the stopped marker is not the storage-failure marker', () => {
  // Two different facts. A stop is not a fault, and must not borrow the warning
  // treatment reserved for an answer storage refused.
  const stopped = message.slice(message.indexOf('message.stopped && ('), message.indexOf('message.unsaved && ('))
  assert.doesNotMatch(stopped, /amber/, 'a user decision is not a warning')
  assert.match(message.slice(message.indexOf('message.unsaved && (')).slice(0, 900), /amber/)
})
