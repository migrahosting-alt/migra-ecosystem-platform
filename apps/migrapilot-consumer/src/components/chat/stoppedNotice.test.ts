/**
 * What the product TELLS the user about a stopped answer must match what it did.
 *
 * 🚨 THIS SENTENCE WAS FALSE IN PRODUCTION-SHAPED STAGING, AND THE USER COULD
 * DISPROVE IT IN ONE CLICK.
 *
 * The notice read "It was not finished, so it was not saved — it will not be
 * here after you reload." That was true while a stopped answer lived only in
 * client state. The moment stopped answers were persisted with
 * `status: 'stopped'`, the product was telling the reader the opposite of what
 * it had just done: the text WAS saved, and pressing reload brought it back
 * with the notice still under it, still claiming it was gone.
 *
 * It is the same failure as the capability sentence that told users MigraPilot
 * could not read PDFs while it was answering from one — a true statement that
 * nobody re-read when the capability underneath it changed. A claim about
 * behaviour has to be re-checked every time the behaviour moves, and a comment
 * asking the next person to remember is not a mechanism. This is.
 *
 * Asserted against the SOURCE with comments stripped, the same way the other
 * Message.tsx contracts are, so the explanation above can never be what makes
 * the test pass.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = (): string => {
  const raw = readFileSync(join(process.cwd(), 'src/components/chat/Message.tsx'), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The rendered notice, without the JSX around it. */
const notice = (): string => {
  const code = source()
  const start = code.indexOf('You stopped this answer.')
  assert.notEqual(start, -1, 'the stopped notice is gone entirely')
  return code.slice(start, start + 400)
}

test('the notice still tells the user they stopped it', () => {
  // The half that was always true, and the reason the notice exists at all.
  assert.match(source(), /You stopped this answer\./)
})

test('🚨 the notice must NOT claim the answer was discarded', () => {
  /*
   * The exact wording is free to change; the CLAIM is not. Each of these says
   * the text is gone, and all of them are now false.
   */
  const text = notice()
  for (const lie of [/not\s+saved/i, /will not be here/i, /after you reload/i, /discarded/i]) {
    assert.ok(!lie.test(text), `the stopped notice still claims the answer was lost: ${lie}`)
  }
})

test('the notice says the answer is incomplete AND kept', () => {
  /*
   * Both halves matter and neither survives alone. "Incomplete" without "kept"
   * leaves the old implication that it is about to vanish; "kept" without
   * "incomplete" invites the reader — and the next turn — to treat a truncated
   * answer as a finished one.
   */
  const text = notice()
  assert.match(text, /incomplete/i, 'the notice no longer says the answer is unfinished')
  assert.match(text, /kept/i, 'the notice no longer says the answer was kept')
})
