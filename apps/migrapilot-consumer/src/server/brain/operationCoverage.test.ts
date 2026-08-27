/**
 * Every operation the type union declares must have an executable transport case.
 *
 * This shipped broken: `processDocument`, `documentStatus`, `documentList` and
 * `documentForget` were added to the union while the switch that turns an
 * operation into a request never got the matching cases. TypeScript was happy —
 * the union was well-formed — and the client could NAME the operations without
 * being able to send them. The escalation silently produced no request at all.
 *
 * A type-level capability with no transport is a false green: it compiles, it
 * deploys, and it does nothing.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('./operations.ts', import.meta.url)), 'utf8')

/** Kinds declared in the union: lines of the form `| { kind: 'x'; ... }`. */
function declaredKinds(): string[] {
  return [...new Set([...source.matchAll(/\|\s*\{\s*kind:\s*'([a-zA-Z0-9_]+)'/g)].map((m) => m[1]!))]
}

/** Kinds the switch can actually turn into a request. */
function routedKinds(): Set<string> {
  return new Set([...source.matchAll(/case\s+'([a-zA-Z0-9_]+)':/g)].map((m) => m[1]!))
}

test('no operation is declared without a route', () => {
  const declared = declaredKinds()
  assert.ok(declared.length > 10, 'sanity: the union was parsed')

  const routed = routedKinds()
  const orphans = declared.filter((kind) => !routed.has(kind))

  assert.deepEqual(
    orphans,
    [],
    `these operations exist in the type union but cannot be sent: ${orphans.join(', ')}. ` +
      'A capability that compiles and does nothing is worse than one that fails loudly.',
  )
})

test('the document operations specifically are routable', () => {
  // Named explicitly because these are the ones that shipped orphaned, and a
  // regression here reads as "background reading silently stopped working".
  const routed = routedKinds()
  for (const kind of ['processDocument', 'documentStatus', 'documentList', 'documentForget']) {
    assert.ok(routed.has(kind), `${kind} must map to a request`)
  }
})

test('every document route targets the Brain document API', () => {
  // The orphaned cases were invisible until the deployed bundle was grepped for
  // the PATH rather than the function name. This asserts the paths exist in
  // source, so the same class of miss fails here first.
  assert.match(source, /'\/api\/ai\/documents\/process'/)
  assert.match(source, /'\/api\/ai\/documents'/)
  assert.match(source, /api\/ai\/documents\/\$\{encodeURIComponent/)
})
