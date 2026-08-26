/**
 * Signing in from the middle of a conversation returns you to it.
 *
 * WHY. A signed-out visitor chatting, then pressing the header's Sign in, landed
 * on the generic welcome screen. Their conversation HAD been claimed into their
 * new account — the claim runs in the callback once the session exists — but the
 * destination was forgotten, so the thread was theirs and nowhere on screen.
 *
 * The header was the only sign-in entry point in the product that omitted
 * `next`, which is exactly why the composer's prompt returned people correctly
 * and the header button did not. That asymmetry is what this guards.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const stripComments = (raw: string): string =>
  raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function sourcesUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourcesUnder(full, found)
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) found.push(full)
  }
  return found
}

test('the header sign-in carries where the user was', () => {
  const code = stripComments(readFileSync(join(process.cwd(), 'src/components/layout/TopBar.tsx'), 'utf8'))
  assert.match(code, /usePathname\(\)/, 'it knows the current path')
  assert.match(code, /next=\$\{encodeURIComponent\(pathname\)\}/, 'and passes it, encoded')
})

test('no sign-in entry point silently drops the return destination', () => {
  /*
   * The regression guard, across the whole app rather than one file: a bare
   * `/api/auth/login` link added anywhere reintroduces exactly this defect, and
   * it is invisible until someone signs in mid-conversation.
   */
  const offenders: string[] = []
  for (const file of sourcesUnder(join(process.cwd(), 'src'))) {
    const code = stripComments(readFileSync(file, 'utf8'))
    // A literal href to the login route with no query string after it.
    if (/href=["'`]\/api\/auth\/login["'`]/.test(code)) {
      offenders.push(file.replace(process.cwd() + '/', ''))
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these sign-in links drop the return path — add ?next=: ${offenders.join(', ')}`,
  )
})
