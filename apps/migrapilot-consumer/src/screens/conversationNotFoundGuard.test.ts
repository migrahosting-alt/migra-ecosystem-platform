/**
 * "Not loaded yet" is not "does not exist".
 *
 * WHY. Signing in from an anonymous conversation landed on the home page with
 * every server hop correct: the login carried `?next=`, the cookie reached the
 * callback, the claim moved the conversation into the account, and the callback
 * redirected to `/chat/<id>`. Then the page bounced the user off it.
 *
 * The guard fired on "the conversation list finished and this id is not in it",
 * which is a RACE — the thread's own fetch is in flight at the same time, and the
 * list simply won. Sending someone away from a URL they were just given requires
 * knowing the conversation is not theirs, and only a 404 says that.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (file: string): string =>
  readFileSync(join(process.cwd(), 'src', file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

test('the home redirect requires a definitive not-found', () => {
  const page = read('screens/ChatPage.tsx')
  assert.match(
    page,
    /if \(!loading && !conversation && isMissingConversation\(id\)\) router\.replace\('\/'\)/,
    'a missing list entry alone must not send the user home',
  )
})

test('only a 404 marks a conversation missing', () => {
  /*
   * A 500 or a dropped connection means we do not know. Treating those the same
   * would send someone home over a transient fault — and they would lose the
   * conversation they were reading.
   */
  const provider = read('state/ChatProvider.tsx')
  assert.match(provider, /if \(response\.status === 404\) \{/)
  assert.match(provider, /missing\.current\.add\(conversationId\)/)
})

test('the missing set is exposed, so the page cannot guess', () => {
  const provider = read('state/ChatProvider.tsx')
  assert.match(provider, /isMissingConversation/)
})
