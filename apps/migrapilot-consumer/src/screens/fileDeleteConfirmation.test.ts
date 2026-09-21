// mp-0012 — deleting a library file asks first. © MigraTeck LLC.
//
// 🚨 IT USED TO HAPPEN ON ONE CLICK, with no confirmation, while deleting a
// CONVERSATION — the less destructive of the two — asks first and calls itself
// "delete it for good". The asymmetry was backwards.
//
// A file is not only a row on this page. Every past conversation answered from
// it keeps citing it, and once the bytes are gone those turns render their
// source as deleted and can never be checked again. §38 measured the follow-on:
// a later question about a removed file was answered from a DIFFERENT document
// until that was fixed. One stray click must not be able to do that silently.
//
// Asserted on the SOURCE with comments stripped, the same way the other screen
// contracts are, so the explanation above can never be what makes it pass.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = (): string => {
  const raw = readFileSync(join(process.cwd(), 'src/screens/FilesPage.tsx'), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('🚨 the trash control ARMS a confirmation — it does not delete', () => {
  const code = source()
  assert.match(code, /aria-label=\{`Delete \$\{file\.name\}`\}[\s\S]{0,200}?setArmedForDelete\(file\.name\)/,
    'the delete button does not arm a confirmation')
  assert.ok(
    !/aria-label=\{`Delete \$\{file\.name\}`\}[\s\S]{0,200}?onClick=\{\(\) => void remove\(file\.name\)\}/.test(code),
    'the delete button still removes the file directly',
  )
})

test('confirming is what actually removes the file', () => {
  const code = source()
  assert.match(code, /Confirm deleting[\s\S]{0,400}?remove\(file\.name\)/,
    'the confirm control does not perform the deletion')
})

test('there is a way OUT of the confirmation', () => {
  /*
   * A confirmation with no escape is a trap rather than a safeguard: someone who
   * armed the wrong row must be able to leave without deleting anything.
   */
  const code = source()
  assert.match(code, /Keep \$\{file\.name\}/, 'no cancel affordance')
  assert.match(code, /setArmedForDelete\(null\)/, 'nothing disarms the confirmation')
})

test('only ONE row can be armed at a time', () => {
  // Two rows offering to confirm at once is how the wrong one gets clicked.
  const code = source()
  assert.match(code, /armedForDelete, setArmedForDelete\] = useState<string \| null>/,
    'arming is not a single-value state')
  assert.match(code, /armedForDelete === file\.name/, 'arming is not scoped to one row')
})
