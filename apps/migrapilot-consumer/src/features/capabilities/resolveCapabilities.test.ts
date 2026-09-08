/**
 * THE RULE THAT KEEPS THE HUB HONEST: a row requires something real behind it.
 *
 * The composer's rows used to be a hardcoded array, each deciding availability
 * with its own probe. That shape produced two real defects here — a row live
 * for signed-out visitors while everything behind it needed an account, and a
 * paperclip that opened a picker for a chat that could not receive a file.
 *
 * As Web, Maps, Email, Drive and GitHub arrive, the failure mode gets worse:
 * a menu that advertises capabilities the engine has not registered. These
 * tests are the guard against exactly that.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveCapabilities,
  type CatalogEntry,
  type RegistryCapability,
} from '@/features/capabilities/resolveCapabilities'

const local = (id: string, readiness: { ready: boolean; reason?: string } | null): CatalogEntry => ({
  id,
  label: id,
  hint: 'h',
  icon: 'file',
  source: { kind: 'local', readiness },
})

const backed = (id: string, capabilityId: string): CatalogEntry => ({
  id,
  label: id,
  hint: 'h',
  icon: 'globe',
  source: { kind: 'registry', capabilityId },
})

const registered = (id: string, over: Partial<RegistryCapability> = {}): RegistryCapability => ({
  id,
  displayName: id,
  description: 'd',
  category: 'web',
  readOnly: true,
  approvalRequired: false,
  available: true,
  ...over,
})

/* ------------------------------------------------------------------ *
 * The central rule
 * ------------------------------------------------------------------ */

test('🚨 an UNREGISTERED capability produces no row at all', () => {
  /*
   * The whole point. A catalog may declare "Search the web" long before the
   * engine can do it; until the capability is registered, the user must not
   * see it. Not greyed out, not "coming soon" — absent.
   */
  const rows = resolveCapabilities({
    catalog: [backed('web', 'migra.search')],
    registry: [],
  })
  assert.deepEqual(rows, [], 'a row appeared for a capability the engine has not registered')
})

test('a registry that has not answered yet still shows no invented rows', () => {
  const rows = resolveCapabilities({ catalog: [backed('web', 'migra.search')], registry: null })
  assert.deepEqual(rows, [])
})

test('a REGISTERED and available capability renders with no excuse attached', () => {
  const rows = resolveCapabilities({
    catalog: [backed('web', 'migra.search')],
    registry: [registered('migra.search')],
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.id, 'web')
  assert.equal(rows[0]!.unavailableReason, undefined)
})

test('registered but UNAVAILABLE renders, carrying the engine’s own reason', () => {
  /*
   * A different fact from "not registered", and it must look different. The
   * user has this capability; it cannot run right now. Hiding it would read as
   * "never built", which sends them looking for something that exists.
   */
  const rows = resolveCapabilities({
    catalog: [backed('web', 'migra.search')],
    registry: [
      registered('migra.search', { available: false, unavailableReason: 'Search is not reachable right now.' }),
    ],
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.unavailableReason, 'Search is not reachable right now.')
})

test('this layer never writes its own excuse when the authority gave one', () => {
  const rows = resolveCapabilities({
    catalog: [backed('web', 'migra.search')],
    registry: [registered('migra.search', { available: false, unavailableReason: 'Quota exhausted until 09:00.' })],
  })
  assert.equal(rows[0]!.unavailableReason, 'Quota exhausted until 09:00.')
})

/* ------------------------------------------------------------------ *
 * Local surfaces
 * ------------------------------------------------------------------ */

test('a local surface renders from its probe, and keeps the probe’s words', () => {
  const rows = resolveCapabilities({
    catalog: [local('file', { ready: false, reason: 'Sign in to manage files.' })],
    registry: [],
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.unavailableReason, 'Sign in to manage files.')
})

test('a probe still in flight shows the row as not-yet-ready, not as ready', () => {
  /*
   * Two wrong answers were available here. Hiding it makes the menu grow under
   * the cursor; calling it ready offers a control that may fail on click.
   */
  const rows = resolveCapabilities({ catalog: [local('file', null)], registry: [] })
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.unavailableReason, 'Checking…')
})

test('a local surface is NOT gated on the registry — it is this app’s own', () => {
  // Photos and files are implemented here. An empty registry must not remove
  // them, or an engine outage would strip the composer of its own controls.
  const rows = resolveCapabilities({
    catalog: [local('image', { ready: true }), local('file', { ready: true })],
    registry: [],
  })
  assert.equal(rows.length, 2)
})

/* ------------------------------------------------------------------ *
 * Shape
 * ------------------------------------------------------------------ */

test('catalog order is preserved so the menu does not reshuffle as probes settle', () => {
  const rows = resolveCapabilities({
    catalog: [local('image', { ready: true }), local('file', null), backed('web', 'migra.search')],
    registry: [registered('migra.search')],
  })
  assert.deepEqual(rows.map((r) => r.id), ['image', 'file', 'web'])
})

test('no implementation detail reaches the row', () => {
  /*
   * The registry deliberately exposes category, readOnly, approvalRequired and
   * schema versions. None of that belongs in a menu a person reads, and an
   * internal capability id must never become user-visible copy.
   */
  const rows = resolveCapabilities({
    catalog: [backed('web', 'migra.search')],
    registry: [registered('migra.search')],
  })
  const row = rows[0]! as unknown as Record<string, unknown>
  for (const leaked of ['category', 'readOnly', 'approvalRequired', 'capabilityId', 'source']) {
    assert.equal(row[leaked], undefined, `the resolved row carries "${leaked}"`)
  }
  assert.ok(!JSON.stringify(row).includes('migra.search'), 'the capability id leaked into the row')
})
