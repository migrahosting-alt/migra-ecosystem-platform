import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const hook = readFileSync(join(process.cwd(), 'src/features/attachments/useAttachments.ts'), 'utf8')
const composer = readFileSync(join(process.cwd(), 'src/components/chat/Composer.tsx'), 'utf8')

/*
 * 🚨 THE DEFECT: a 35 MB PDF failed with "The upload could not reach the server"
 * while the server had answered with a 413 and an HTML page from the proxy. The
 * old catch wrapped BOTH the fetch and response.json(), so any thrown exception
 * became a network fault.
 */
test('a server that answers is never reported as unreachable', () => {
  // The fetch and the parse must be in SEPARATE try blocks — they are different
  // failures and call for different things from the user.
  const fetchCatch = /response = await fetch\('\/api\/files'[\s\S]{0,200}?\} catch \{[\s\S]{0,200}?could not reach the server/
  assert.match(hook, fetchCatch, 'only a failed fetch may claim unreachability')

  /*
   * Bounded by the code that FOLLOWS the parse rather than by a character
   * budget. The previous form allowed 400 characters between the two anchors, so
   * adding a comment to the very block it guards broke it while the invariant
   * still held — a test that fails on prose is measuring the wrong thing.
   *
   * This is also the stronger claim: it checks not only that the 413 branch
   * exists, but that nothing in the parse-failure path claims unreachability.
   */
  const afterParse = hook.slice(hook.indexOf('payload = await response.json()'))
  const parseFailurePath = afterParse.slice(0, afterParse.indexOf('const uploaded = outcomeOfUpload'))
  assert.ok(parseFailurePath.length > 0, 'the parse-failure path must be locatable')
  assert.match(parseFailurePath, /response\.status === 413/,
    'a non-JSON answer must report what the server actually said')
  assert.doesNotMatch(parseFailurePath, /could not reach the server/,
    'a server that answered must never be described as unreachable')
})

test('a 413 says the file is too large, not that the server vanished', () => {
  assert.match(hook, /too large to upload/)
  assert.match(hook, /refused the upload \(error \$\{response\.status\}\)/,
    'other statuses surface the real code rather than a guess')
})

/*
 * 🚨 THE SECOND DEFECT: a .wav refusal stayed on screen while an unrelated PDF
 * was attached, because every refusal shared one global slot with image errors.
 */
test('a new selection clears the previous refusals', () => {
  /*
   * Read from `intake` rather than `onPicked`. The clearing moved there when the
   * picker, drop and paste were unified onto one handler — which means this
   * property now holds for all three entry points instead of only the picker.
   * A dropped file used to leave a stale refusal from an earlier pick on screen.
   */
  const intake = composer.slice(composer.indexOf('const intake'))
  const body = intake.slice(0, intake.indexOf('if (documents.length'))
  assert.match(body, /setRefusals\(\[\]\)/, 'stale refusals are cleared on a new selection')
  assert.match(body, /setImageError\(null\)/, 'and so is the image slot')
})

test('a refusal names the file that caused it', () => {
  assert.match(composer, /refused\.push\(\{ name: file\.name, message: verdict\.message \}\)/)
  // Rendered per file and dismissible on its own, so one complaint among several
  // can be cleared without clearing the others.
  assert.match(composer, /refusals\.map\(/)
  assert.match(composer, /setRefusals\(\(current\) => current\.filter\(/)
})
