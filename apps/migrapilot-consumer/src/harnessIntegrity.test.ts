/**
 * THE HARNESSES ARE EVIDENCE INSTRUMENTS, AND THIS IS THEIR CALIBRATION.
 *
 * ---------------------------------------------------------------------------
 * WHY A TEST GUARDS TEST TOOLING
 *
 * A hardcoded `127.0.0.1:3407` in a verification harness is not untidiness. It
 * reproduces, exactly, a false green this project has already had: another
 * session's product held the expected port, answered 200 throughout, and
 * browser runs reported success against an application nobody was testing.
 *
 * Tooling that can lie about what it tested corrupts every result downstream of
 * it, so the rule outranks feature work — and a rule with no failing test is a
 * preference. Restoring a hardcoded target must BREAK something.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ASSERTED SYNTACTICALLY, AND WHY THAT IS LEGITIMATE HERE
 *
 * "Does this file contain a literal port" is a question ABOUT THE SOURCE TEXT,
 * and matching source text answers it exactly. That is different from the
 * mistake `coldStartProgress.test.ts` used to make, where source text was
 * matched to answer a question about what a user SEES. Behaviour is tested
 * behaviourally below; only the literal is matched as text.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { assertClientBuild, resolveRigTarget } from '../scripts/rigTarget.js'

/** Every browser harness that collects acceptance evidence. */
const HARNESSES = [
  'scripts/verify-rename-approval.cjs',
  'scripts/verify-rename-faults.cjs',
  'scripts/verify-rename-replay.cjs',
  'scripts/verify-cold-start.mjs',
]

const source = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

/* ------------------------------------------------------------------ *
 * No harness may name its target
 * ------------------------------------------------------------------ */

test('no harness contains a literal host:port target', () => {
  for (const rel of HARNESSES) {
    const code = source(rel)
      // Comments explain the incident by name; the ban is on executable targets.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*(\/\/|#).*$/gm, '')
    assert.doesNotMatch(
      code,
      /https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?/,
      `${rel} names its target. Resolve it from the environment or run metadata instead — ` +
        'a literal reproduces the false green where another product answered on the expected port.',
    )
    assert.doesNotMatch(code, /\b(?:3407|3399|13990)\b/, `${rel} contains a literal port`)
  }
})

test('every harness resolves its target and fails closed', () => {
  for (const rel of HARNESSES) {
    const code = source(rel)
    assert.ok(
      /resolveRigTarget\(|MIGRAPILOT_RIG_URL/.test(code),
      `${rel} does not resolve its target from the environment`,
    )
    assert.ok(/assertRigIdentity\(|assertRigIdentity\b/.test(code), `${rel} does not assert rig identity`)
  }
})

test('no harness discovers its target by scanning', () => {
  for (const rel of HARNESSES) {
    const code = source(rel).replace(/\/\*[\s\S]*?\*\//g, '')
    assert.doesNotMatch(code, /\bss -ltnp?\b|\blsof\b|\bnetstat\b|\bpgrep\b/, `${rel} looks for its target`)
  }
})

/* ------------------------------------------------------------------ *
 * The resolver itself — behaviour, not text
 * ------------------------------------------------------------------ */

test('an unset environment FAILS CLOSED, with no default and no fallback', () => {
  assert.throws(() => resolveRigTarget({}), /RIG TARGET UNRESOLVED/)
  // The specific thing that must never happen: quietly picking a port.
  try {
    resolveRigTarget({})
  } catch (error) {
    assert.doesNotMatch((error as Error).message, /\b3407\b|\b3399\b/, 'the error must not name a default target')
  }
})

test('a bare URL is accepted, and its source is reported', () => {
  const target = resolveRigTarget({ MIGRAPILOT_RIG_URL: 'http://example.invalid:1234/' })
  assert.equal(target.url, 'http://example.invalid:1234', 'a trailing slash is normalised away')
  assert.equal(target.source, 'MIGRAPILOT_RIG_URL')
  assert.equal(target.expectedBuildId, undefined, 'a bare URL carries no build to compare against')
})

test('run metadata is preferred, and carries the build the LAUNCHER recorded', () => {
  const target = resolveRigTarget({ MIGRAPILOT_RIG_METADATA: join(process.cwd(), 'test/fixtures/rig-metadata.json') })
  assert.equal(target.url, 'http://example.invalid:4321')
  assert.equal(target.expectedBuildId, 'BUILD_FROM_METADATA')
  // This is what makes metadata worth more than a URL: identity stops being
  // whatever the responder claims and becomes a comparison.
})

test('unusable metadata fails closed rather than falling back', () => {
  assert.throws(
    () => resolveRigTarget({ MIGRAPILOT_RIG_METADATA: '/nonexistent/rig.json' }),
    /RIG TARGET UNRESOLVED/,
  )
})

/* ------------------------------------------------------------------ *
 * RULE 4 — the server's build is not the browser's build
 * ------------------------------------------------------------------ */

test('a stale client is caught, even when the server reports the right build', () => {
  // Measured: /api/version reported the fixed build and the served chunk had the
  // fixed markup — both true — while an open tab ran the pre-fix client.
  assert.throws(
    () =>
      assertClientBuild(
        ['http://rig/_next/static/chunks/from-an-old-build.js'],
        '/does/not/matter',
        () => false,
      ),
    /THE BROWSER IS RUNNING A DIFFERENT BUILD/,
  )
})

test('a page that executed no app assets is unverifiable, not passing', () => {
  assert.throws(() => assertClientBuild([], '/x', () => true), /CLIENT BUILD UNVERIFIABLE/)
})

test('a fresh client against its own build passes', () => {
  const result = assertClientBuild(
    ['http://rig/_next/static/chunks/a.js', 'http://rig/_next/static/chunks/a.js?v=1'],
    '/x',
    () => true,
  )
  assert.equal(result.assets, 1, 'the same asset with a query string is one asset')
})

/* ------------------------------------------------------------------ *
 * The bridge that once "passed by not existing"
 * ------------------------------------------------------------------ */

test('the CommonJS bridge actually exports the functions', async () => {
  // A `module.exports` in an ESM file produced an EMPTY export once, and the
  // guard passed by not existing. Bridges get their own smoke test.
  const bridge = await import('../scripts/rigTarget.cjs')
  const api = (bridge as { default?: Record<string, unknown> }).default ?? bridge
  for (const name of ['resolveRigTarget', 'assertClientBuild']) {
    assert.equal(typeof (api as Record<string, unknown>)[name], 'function', `${name} is not exported`)
  }
})

test('the fixture the metadata test depends on is tracked', () => {
  assert.ok(existsSync(join(process.cwd(), 'test/fixtures/rig-metadata.json')))
})
