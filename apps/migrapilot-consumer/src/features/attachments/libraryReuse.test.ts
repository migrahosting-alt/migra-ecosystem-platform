/**
 * REUSING A FILE FROM THE LIBRARY — and the convergence that makes it safe.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE GAP
 *
 * The Files page stored `matrix_sales.xlsx` correctly and Chat could not reach
 * it. Both paperclip rows opened the operating system's picker, which cannot
 * see a file that already lives on the server, so reuse meant finding the
 * original on disk and sending the bytes a second time. "Upload once, reuse
 * across conversations" was not true of the product.
 *
 * ---------------------------------------------------------------------------
 * WHAT MUST NOT HAPPEN WHILE FIXING IT
 *
 * The tempting shape is a second attachment kind that carries a library
 * reference. That would give the turn two answers to "what is this grounded
 * in", and every downstream rule — readiness, grounding, structured analysis,
 * provenance — would need teaching about both. So the property under test is
 * CONVERGENCE: after either path, the dispatched shape is identical and
 * nothing downstream can tell which one happened.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const hookSource = readFileSync(
  join(process.cwd(), 'src/features/attachments/useAttachments.ts'),
  'utf8',
)

test('the library path sends NO bytes — reuse must not upload a second copy', () => {
  /*
   * `POST /api/files` is the upload. It appears in `send`, which carries a
   * `File`. If it appeared in the library path too, picking an existing
   * document would write a duplicate into the caller's directory and count
   * twice against their library limit.
   */
  const start = hookSource.indexOf('const addFromLibrary')
  const end = hookSource.indexOf('const retry')
  assert.ok(start > 0 && end > start, 'addFromLibrary could not be located')
  const libraryPath = hookSource.slice(start, end)

  assert.doesNotMatch(
    libraryPath,
    /fetch\('\/api\/files',\s*\{\s*method:\s*'POST'/,
    'the library path uploads — a file already on the server must not be sent again',
  )
  assert.doesNotMatch(libraryPath, /FormData/, 'the library path builds an upload body')
})

test('both paths settle readiness through ONE function', () => {
  /*
   * The forking risk, stated as a test. `settle` is what turns a stored file
   * into an answerable one and decides ready / structured / unsearchable /
   * processing. Two copies of that logic would drift, and the drift would show
   * up as a library file that says "ready" while the Brain cannot search it.
   */
  assert.match(hookSource, /const settle = useCallback/, 'the shared readiness step is gone')
  const settleCalls = [...hookSource.matchAll(/await settle\(|void settle\(/g)]
  assert.equal(
    settleCalls.length,
    2,
    `expected exactly two callers of settle (upload and library), found ${settleCalls.length}`,
  )
  // And the index endpoint is called in exactly one place — inside `settle`.
  const indexCalls = [...hookSource.matchAll(/'\/api\/files\/index'/g)]
  assert.equal(
    indexCalls.length,
    1,
    'the indexing call is duplicated — readiness rules will drift between the two paths',
  )
})

test('a library pick produces the same attachment shape as an upload', () => {
  /*
   * Both paths push an object with the same fields into the same list. The
   * dispatch in `Composer.tsx` reads `attachments` and sends NAMES; if the
   * library path added a different shape, that mapping would need a branch —
   * and the branch is the fork this test exists to prevent.
   */
  const composer = readFileSync(join(process.cwd(), 'src/components/chat/Composer.tsx'), 'utf8')
  const dispatch = composer.slice(composer.indexOf('const readyFiles'), composer.indexOf('const imageIds') + 200)
  assert.doesNotMatch(
    dispatch,
    /library|fromLibrary|isLibrary/i,
    'the dispatch distinguishes library attachments — the two paths have not converged',
  )
})

test('attaching the same file twice is refused, not duplicated', () => {
  // Grounding a turn in one document twice adds nothing and doubles its weight
  // in retrieval.
  const start = hookSource.indexOf('const addFromLibrary')
  const libraryPath = hookSource.slice(start, hookSource.indexOf('const retry'))
  assert.match(
    libraryPath,
    /current\.some\(\(a\) => a\.name === file\.name/,
    'nothing stops the same library file being attached twice',
  )
})

test('the picker never names a filesystem path', () => {
  /*
   * The listing is the caller's own directory, resolved server-side from the
   * session. A component that could send a path would be the same hazard the
   * project lane refuses: a browser choosing what the server reads.
   */
  const picker = readFileSync(
    join(process.cwd(), 'src/features/attachments/FileLibraryPicker.tsx'),
    'utf8',
  )
  assert.doesNotMatch(picker, /\broot\b\s*[:=]/, 'the picker carries a root')
  assert.doesNotMatch(picker, /\bpath\b\s*[:=]/, 'the picker carries a path')
  // It asks for the library and sends back names it was given, nothing more.
  assert.match(picker, /fetch\('\/api\/files'\)/)
})

test('the library row is gated on the same availability as documents', () => {
  // A row that needs an account, offered to a signed-out visitor, is the dead
  // control this menu already learned about once.
  const composer = readFileSync(join(process.cwd(), 'src/components/chat/Composer.tsx'), 'utf8')
  const row = composer.slice(composer.indexOf("id: 'library'"), composer.indexOf("id: 'library'") + 400)
  assert.match(
    row,
    /documentsReady \? \{\} : \{ unavailableReason: documentsReason \}/,
    'the library row is not gated — it would 401 for a signed-out visitor',
  )
})
