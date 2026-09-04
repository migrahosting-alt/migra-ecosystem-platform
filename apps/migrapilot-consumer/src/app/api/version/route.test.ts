/**
 * Release identity, reported by the process that is actually serving.
 *
 * 🚨 THE INCIDENT. A fix was committed, tested, mutation-proven and pushed. The
 * owner tested the real product and got the pre-fix answer, because production
 * had been serving a build from three days earlier — and nothing in the loop
 * could tell, since nothing ever asked what was running. A truthful harness gave
 * a false sense of product readiness.
 *
 * THE STANDARD THIS ENFORCES: no live-product evidence is valid unless the exact
 * running release identity is captured with it. "Tested live" means "tested live
 * against release X, commit Y".
 *
 * So the values must come from the ARTIFACT, never from configuration — an env
 * var describes the machine, not the code it is running.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { GET } from './route'

/** The route reads its own serving directory, so a test moves into a fake one. */
function servingDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'migrapilot-version-'))
  mkdirSync(join(dir, '.next'), { recursive: true })
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, '.next', name), body)
  return dir
}

const read = async (): Promise<Record<string, unknown>> => (await GET()).json()

const withCwd = async <T>(dir: string, fn: () => Promise<T>): Promise<T> => {
  const previous = process.cwd()
  process.chdir(dir)
  try {
    return await fn()
  } finally {
    process.chdir(previous)
  }
}

test('🚨 it reports the BUILD ID of the artifact it is serving', async () => {
  /*
   * The strongest of the three, and the reason this is not just an env var:
   * Next generates it per build and it lives inside `.next`, so it identifies
   * the bundle rather than anybody's intention about the bundle.
   */
  const dir = servingDir({ BUILD_ID: 'OspvBwR8WxYrhFPf7AyPr\n' })
  const body = await withCwd(dir, read)
  assert.equal(body.buildId, 'OspvBwR8WxYrhFPf7AyPr')
})

test('and the commit and release stamped INTO the artifact at build time', async () => {
  const dir = servingDir({
    BUILD_ID: 'abc123',
    'RELEASE.json': JSON.stringify({ commit: 'f5f94e44', release: 'identifier-09040504', builtAt: '2026-09-04T05:00:00Z' }),
  })
  const body = await withCwd(dir, read)
  assert.equal(body.commit, 'f5f94e44')
  assert.equal(body.release, 'identifier-09040504')
  assert.equal(body.builtAt, '2026-09-04T05:00:00Z')
  assert.equal(body.stamped, true)
})

test('an unstamped build says so instead of inventing an identity', async () => {
  // A development server has no release. Reporting one would be the same class
  // of lie the whole endpoint exists to prevent.
  const dir = servingDir({ BUILD_ID: 'dev-build' })
  const body = await withCwd(dir, read)
  assert.equal(body.commit, null)
  assert.equal(body.release, null)
  assert.equal(body.stamped, false, 'and "unstamped" is distinguishable from "badly stamped"')
})

test('🚨 A MALFORMED STAMP IS ABSENT, NOT GUESSED AT', async () => {
  // A deployment check that accepts junk is not a check.
  const dir = servingDir({ BUILD_ID: 'abc123', 'RELEASE.json': '{ this is not json' })
  const body = await withCwd(dir, read)
  assert.equal(body.commit, null)
  assert.equal(body.release, null)
})

test('a missing artifact reports null rather than failing the request', async () => {
  // The endpoint must answer even when what it describes is broken — a 500 here
  // tells a deploy nothing about which release is up.
  const dir = mkdtempSync(join(tmpdir(), 'migrapilot-empty-'))
  const body = await withCwd(dir, read)
  assert.equal(body.buildId, null)
  assert.equal(body.stamped, false)
})

test('it never answers from configuration', async () => {
  /*
   * The whole point: an environment variable describes the machine, not the code
   * it is running. If this could be set by env, a stale bundle could be made to
   * claim any identity — which is exactly the failure being closed.
   */
  const dir = servingDir({ BUILD_ID: 'artifact-truth' })
  process.env.MIGRAPILOT_COMMIT = 'a-lie'
  process.env.MIGRAPILOT_RELEASE = 'also-a-lie'
  try {
    const body = await withCwd(dir, read)
    assert.equal(body.buildId, 'artifact-truth')
    assert.notEqual(body.commit, 'a-lie')
    assert.notEqual(body.release, 'also-a-lie')
  } finally {
    delete process.env.MIGRAPILOT_COMMIT
    delete process.env.MIGRAPILOT_RELEASE
  }
})

test('and it is not cached, so a deploy check cannot read a stale answer', async () => {
  const dir = servingDir({ BUILD_ID: 'abc123' })
  const response = await withCwd(dir, () => GET())
  assert.match(response.headers.get('cache-control') ?? '', /no-store/)
})
