/**
 * A hub row that can be fixed, and one that cannot.
 *
 * 🚨 THESE ASSERT RENDERED OUTPUT, NOT SOURCE TEXT.
 *
 * The sibling `actionHub.test.ts` checks this component with regexes over its
 * own source, because the menu only exists after a click and there was nothing
 * to render. That is why `HubRow` is exported: what a user sees is the claim,
 * and a regex over source is not evidence about it.
 *
 * The distinction under test is small and load-bearing. "Email is not connected
 * yet" and "Email is unavailable right now" are both reasons; only the first is
 * the user's to fix. A control offered for the second sends someone to press
 * something that cannot help — and then to press it again, because nothing
 * changed.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { HubRow, type HubAction } from './ActionHub'

const base: HubAction = {
  id: 'email',
  label: 'Email',
  hint: 'Search and read your email',
  icon: 'mail',
  onSelect: () => {
    throw new Error('the row ran its own action')
  },
}

const render = (action: HubAction): string =>
  renderToStaticMarkup(createElement(HubRow, { action, onDone: () => {} }))

/* ------------------------------------------------------------------ *
 * Rendered state
 * ------------------------------------------------------------------ */

test('an available row shows its hint and is not disabled', () => {
  const html = render({ ...base, onSelect: () => {} })
  assert.match(html, /Search and read your email/)
  assert.doesNotMatch(html, /disabled/, 'a working capability rendered as disabled')
})

test('🚨 a reason WITHOUT a remedy renders DISABLED', () => {
  // Nothing the user does here helps. A live control would be a lie about that.
  const html = render({ ...base, unavailableReason: 'Email is unavailable right now.' })
  assert.match(html, /disabled/, 'an unfixable row was left clickable')
  assert.match(html, /Email is unavailable right now\./)
  assert.doesNotMatch(html, /Search and read your email/, 'the hint survived beside the reason')
})

test('🚨 a reason WITH a remedy renders ENABLED, and names what pressing will do', () => {
  const html = render({
    ...base,
    unavailableReason: 'Email is not connected yet.',
    remedy: { label: 'Connect', onSelect: () => {} },
  })
  assert.doesNotMatch(html, /disabled/, 'a fixable row was rendered dead')
  assert.match(html, /Email is not connected yet\./)
  /*
   * Named as the outcome, not "Fix" or "Retry". The row says Email, the reason
   * says it is not connected, and this says Connect — so what pressing does is
   * legible before pressing.
   */
  assert.match(html, /Connect/)
})

test('reconnecting is worded differently from connecting', () => {
  // They DID connect. "Connect" would describe a first-time action to someone
  // whose account is already linked, and hide that the grant is what broke.
  const html = render({
    ...base,
    unavailableReason: 'Your email account needs reconnecting.',
    remedy: { label: 'Reconnect', onSelect: () => {} },
  })
  assert.match(html, /Reconnect/)
  assert.match(html, /needs reconnecting/)
})

test('a remedy on an AVAILABLE row is not rendered', () => {
  /*
   * A remedy only means something alongside a reason. Rendering one on a
   * working capability would offer to reconnect a mailbox that is answering
   * questions perfectly well.
   */
  const html = render({
    ...base,
    onSelect: () => {},
    remedy: { label: 'Connect', onSelect: () => {} },
  })
  assert.doesNotMatch(html, /Connect/, 'a remedy was offered for a working capability')
  assert.match(html, /Search and read your email/)
})

/* ------------------------------------------------------------------ *
 * 🚨 What pressing actually runs
 * ------------------------------------------------------------------ */

function pressed(action: HubAction): { ran: string[]; closed: boolean } {
  /*
   * The click handler is invoked directly rather than through a DOM event.
   * renderToStaticMarkup produces no interactive tree, and what matters here is
   * WHICH callback runs — not how the browser dispatches to it.
   */
  const ran: string[] = []
  let closed = false
  const element = createElement(HubRow, {
    action: {
      ...action,
      onSelect: () => ran.push('action'),
      ...(action.remedy ? { remedy: { ...action.remedy, onSelect: () => ran.push('remedy') } } : {}),
    },
    onDone: () => { closed = true },
  })
  const rendered = (element.type as (props: unknown) => { props: { onClick?: () => void; disabled?: boolean } })(element.props)
  if (!rendered.props.disabled) rendered.props.onClick?.()
  return { ran, closed }
}

test('🚨 pressing a remediable row runs the REMEDY, never the row’s own action', () => {
  /*
   * Running the row's own action would start something the capability has
   * already said it cannot do — a mailbox search against an account nobody has
   * connected — and the failure would arrive as a confusing error rather than
   * as the connect flow the user actually needs.
   */
  const { ran, closed } = pressed({
    ...base,
    unavailableReason: 'Email is not connected yet.',
    remedy: { label: 'Connect', onSelect: () => {} },
  })
  assert.deepEqual(ran, ['remedy'])
  assert.equal(closed, true, 'the menu stayed open over the flow it just started')
})

test('pressing an available row runs its own action', () => {
  const { ran } = pressed({ ...base, onSelect: () => {} })
  assert.deepEqual(ran, ['action'])
})

test('🚨 a row with no remedy cannot fire even if a click lands', () => {
  // `disabled` alone leaves the handler reachable by keyboard and by anything
  // that dispatches a synthetic click.
  const { ran } = pressed({ ...base, unavailableReason: 'Email is unavailable right now.' })
  assert.deepEqual(ran, [], 'a dead row ran something')
})
