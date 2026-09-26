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

test('🚨 deleting one file does not claim the whole library is unsearchable', () => {
  /*
   * MEASURED ON STAGING 2026-09-26. After deleting one 83-byte file the panel
   * read "Searchable — Not yet", which says NOTHING can be searched, while the
   * other thirteen files were still indexed — a reload of the same page showed
   * "Searchable — 13 entries". The Brain's own log confirmed the truth at the
   * time: `sync_completed files=13 chunks=410 deletedFiles=1`.
   *
   * The old code reasoned correctly that the previous reading was stale and then
   * replaced it with a definite falsehood. Staleness is fixed by ASKING; a user
   * who believes their library stopped being searchable re-indexes 66 MB for no
   * reason, or stops trusting the answers they get.
   */
  const code = source()
  const handler = /const remove = useCallback\(([\s\S]*?)\n  \)/.exec(code)?.[1] ?? ''
  assert.ok(handler, 'could not find the remove handler to assert on')
  assert.match(handler, /await refreshIndex\(\)/, 'the delete handler does not re-read the index status')
  assert.ok(
    !/setIndex\(\{\s*indexed:\s*false\s*\}\)/.test(handler),
    'the delete handler still asserts the library is unsearchable instead of asking',
  )
})
