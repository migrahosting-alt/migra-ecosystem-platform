/**
 * The model picker showed four lines of engineering vocabulary to a user:
 *
 *   Migra Core unavailable — no approved model for chat.general
 *   Migra Logic unavailable — no approved model for reasoning.deep
 *   Migra Swift unavailable — no approved model for chat.fast
 *   Migra Atlas unavailable — no approved model for chat.long_context
 *
 * Those are the resolver's operator-facing reasons, rendered verbatim. The
 * property under test is not the wording — it is that no internal capability
 * identifier can reach the screen, including through a reason shape nobody has
 * written yet.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { humanUnavailableReason, leaksInternalIdentifier } from './unavailableReason'

// Verbatim from modelFamilyResolver.ts — if a shape changes there, these stop
// matching the real thing and the fallback assertions below are what save us.
const REAL_REASONS = [
  'no approved model for chat.general',
  'no approved model for reasoning.deep',
  'no approved model for chat.fast',
  'no approved model for chat.long_context',
  'no approved model for vision.general',
  'the approved model for chat.general is not installed',
  "no installed model meets Migra Atlas's requirements",
]

describe('humanUnavailableReason', () => {
  it('never renders an internal capability identifier', () => {
    for (const reason of REAL_REASONS) {
      const text = humanUnavailableReason({ displayName: 'Migra Core', unavailableReason: reason })
      assert.equal(
        leaksInternalIdentifier(text),
        false,
        `leaked an identifier for "${reason}": ${text}`,
      )
      assert.ok(!text.includes('chat.'), `leaked a capability id: ${text}`)
      assert.ok(!text.includes('reasoning.'), `leaked a capability id: ${text}`)
      assert.ok(!text.includes('vision.'), `leaked a capability id: ${text}`)
    }
  })

  it('names the family so a reader knows which control it refers to', () => {
    for (const reason of REAL_REASONS) {
      const text = humanUnavailableReason({ displayName: 'Migra Atlas', unavailableReason: reason })
      assert.ok(text.includes('Migra Atlas'), `does not name the family: ${text}`)
    }
  })

  it('separates "nothing approved yet" from "approved but missing"', () => {
    const notYet = humanUnavailableReason({
      displayName: 'Migra Core',
      unavailableReason: 'no approved model for chat.general',
    })
    const missing = humanUnavailableReason({
      displayName: 'Migra Core',
      unavailableReason: 'the approved model for chat.general is not installed',
    })
    assert.notEqual(notYet, missing)
    // "Not approved yet" is a deliberate state, not a fault: it must not read as
    // one, or a user reports a bug that does not exist.
    assert.ok(/no model has been approved/i.test(notYet), notYet)
    assert.ok(/isn’t installed/i.test(missing), missing)
  })

  it('keeps the requirements case distinct too', () => {
    const text = humanUnavailableReason({
      displayName: 'Migra Atlas',
      unavailableReason: "no installed model meets Migra Atlas's requirements",
    })
    assert.ok(/requirements/i.test(text), text)
    assert.equal(leaksInternalIdentifier(text), false)
  })

  it('falls back safely for a reason shape that does not exist yet', () => {
    // The whole point: a future resolver reason must not reach the screen just
    // because no branch recognised it.
    const text = humanUnavailableReason({
      displayName: 'Migra Swift',
      unavailableReason: 'quota exhausted for tier.premium on provider.acme',
    })
    assert.equal(leaksInternalIdentifier(text), false, text)
    assert.ok(text.includes('Migra Swift'), text)
    assert.ok(!text.includes('tier.premium'), text)
    assert.ok(!text.includes('provider.acme'), text)
  })

  it('handles a missing reason without rendering "undefined"', () => {
    const text = humanUnavailableReason({ displayName: 'Migra Logic' })
    assert.ok(!/undefined|null/i.test(text), text)
    assert.ok(text.includes('Migra Logic'), text)
  })
})

describe('leaksInternalIdentifier', () => {
  it('detects the identifier shape it exists to catch', () => {
    assert.equal(leaksInternalIdentifier('no approved model for chat.general'), true)
    assert.equal(leaksInternalIdentifier('reasoning.deep'), true)
    assert.equal(leaksInternalIdentifier('provider.acme is down'), true)
  })

  it('does not fire on ordinary prose or sentence ends', () => {
    assert.equal(leaksInternalIdentifier('Migra Core isn’t available yet.'), false)
    assert.equal(
      leaksInternalIdentifier('Migra Core is temporarily unavailable — its approved model isn’t installed.'),
      false,
    )
    assert.equal(leaksInternalIdentifier('No model meets its requirements.'), false)
  })
})
