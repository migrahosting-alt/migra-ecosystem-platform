/**
 * The model picker, after it moved into the composer.
 *
 * 🚨 WHAT WAS ON SCREEN. A full-width dropdown above the input box, with four
 * lines of governance state printed permanently underneath it:
 *
 *     Migra Core isn’t available yet — no model has been approved for it.
 *     Migra Logic isn’t available yet — no model has been approved for it.
 *     Migra Swift isn’t available yet — no model has been approved for it.
 *     Migra Atlas isn’t available yet — no model has been approved for it.
 *
 * Every sentence true, and the effect wrong: on a page that exists for typing a
 * message, the loudest element was a list of things that do not work.
 *
 * The properties below are the ones that must survive the redesign. Not the
 * layout — the layout is Bonex's to judge in the real UI — but the contract:
 * families stay visible, unavailable ones stay unselectable and keep their real
 * reason, the reason belongs to the menu, the collapsed control says one thing,
 * and no internal identifier reaches any of it.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  AUTOMATIC_LABEL,
  buildModelOptions,
  collapsedLabel,
  selectable,
  unavailableNote,
} from './modelOptions'
import { leaksInternalIdentifier } from './unavailableReason'
import type { MigraFamilyView } from './useModelFamilies'

const family = (over: Partial<MigraFamilyView> & { id: string }): MigraFamilyView => ({
  displayName: over.id,
  tagline: 'a tagline',
  description: '',
  recommended: false,
  available: true,
  governed: true,
  ...over,
})

/** The catalog from the screenshot: one available, four blocked on approval. */
const CATALOG: MigraFamilyView[] = [
  family({ id: 'forge', displayName: 'Migra Forge', tagline: 'Everyday answers', recommended: true }),
  family({
    id: 'core',
    displayName: 'Migra Core',
    available: false,
    unavailableReason: 'no approved model for chat.general',
  }),
  family({
    id: 'logic',
    displayName: 'Migra Logic',
    available: false,
    unavailableReason: 'no approved model for reasoning.deep',
  }),
  family({
    id: 'swift',
    displayName: 'Migra Swift',
    available: false,
    unavailableReason: 'no approved model for chat.fast',
  }),
  family({
    id: 'atlas',
    displayName: 'Migra Atlas',
    available: false,
    unavailableReason: 'no approved model for chat.long_context',
  }),
]

describe('the collapsed control', () => {
  it('says Automatic when the server is left to route', () => {
    assert.equal(collapsedLabel(CATALOG, undefined), AUTOMATIC_LABEL)
  })

  it('says the chosen family, and nothing else', () => {
    assert.equal(collapsedLabel(CATALOG, 'forge'), 'Migra Forge')
  })

  it('🚨 never reports availability when closed', () => {
    /*
     * The whole defect: status belongs to the opened menu. A collapsed control
     * that mentions unavailability puts the same four sentences back on the page
     * in a shorter form.
     */
    for (const selection of [undefined, 'forge']) {
      const label = collapsedLabel(CATALOG, selection)
      assert.ok(!/unavailable|isn’t available|not available/i.test(label), label)
      assert.ok(!/approved|approval/i.test(label), label)
    }
  })

  it('falls back to Automatic for a selection the catalog no longer offers', () => {
    // A family can be retired between visits. The label must not go blank.
    assert.equal(collapsedLabel(CATALOG, 'retired-family'), AUTOMATIC_LABEL)
  })
})

describe('the opened menu', () => {
  it('offers Automatic first — the default, and the way back', () => {
    const options = buildModelOptions(CATALOG)
    assert.equal(options[0]!.id, undefined)
    assert.equal(options[0]!.label, AUTOMATIC_LABEL)
    assert.equal(options[0]!.available, true)
  })

  it('🚨 keeps every unavailable family VISIBLE', () => {
    // Hiding one would look like the capability never existed.
    const labels = buildModelOptions(CATALOG).map((o) => o.label)
    for (const name of ['Migra Forge', 'Migra Core', 'Migra Logic', 'Migra Swift', 'Migra Atlas']) {
      assert.ok(labels.includes(name), `${name} disappeared from the menu`)
    }
  })

  it('keeps the catalog order rather than sorting the blocked ones away', () => {
    // Sorting by availability would quietly bury a family the owner put first.
    const ids = buildModelOptions(CATALOG).slice(1).map((o) => o.id)
    assert.deepEqual(ids, CATALOG.map((f) => f.id))
  })

  it('marks a blocked family unavailable and carries its real reason', () => {
    const core = buildModelOptions(CATALOG).find((o) => o.id === 'core')!
    assert.equal(core.available, false)
    assert.equal(core.status, 'unavailable')
    assert.match(core.hint, /no model has been approved for it/)
    assert.match(core.hint, /Migra Core/)
  })

  it('the reason REPLACES the tagline, never sits beside it', () => {
    // Showing what a family is for next to why it cannot be picked is how a dead
    // control reads.
    const core = buildModelOptions(CATALOG).find((o) => o.id === 'core')!
    assert.ok(!core.hint.includes('a tagline'), core.hint)

    const forge = buildModelOptions(CATALOG).find((o) => o.id === 'forge')!
    assert.equal(forge.hint, 'Everyday answers')
    assert.equal(forge.status, undefined)
  })

  it('an available family carries no unavailable status', () => {
    for (const o of buildModelOptions(CATALOG).filter((x) => x.available)) {
      assert.equal(o.status, undefined, `${o.label} is available and flagged unavailable`)
    }
  })
})

describe('🚨 no internal identifier reaches any row', () => {
  it('not through a reason shape the translator knows', () => {
    for (const o of buildModelOptions(CATALOG)) {
      assert.ok(!leaksInternalIdentifier(o.hint), `leaked: ${o.hint}`)
      assert.ok(!leaksInternalIdentifier(o.label), `leaked: ${o.label}`)
    }
  })

  it('nor through one nobody has written yet', () => {
    /*
     * The guard that matters. A reason shape added to the resolver later would
     * otherwise render verbatim with no test failing — which is exactly how
     * `chat.general` reached the screen the first time.
     */
    const exotic = family({
      id: 'x',
      displayName: 'Migra X',
      available: false,
      unavailableReason: 'quota exhausted for vision.general on tier premium',
    })
    const note = unavailableNote(exotic)
    assert.ok(!leaksInternalIdentifier(note), `leaked: ${note}`)
    assert.match(note, /Migra X/)
  })

  it('nor a backend id, even when the catalog carries one', () => {
    const withBackend = family({
      id: 'forge',
      displayName: 'Migra Forge',
      tagline: 'Everyday answers',
      selectedBackend: 'qwen3-coder:30b',
      basis: 'chat.general',
    })
    for (const o of buildModelOptions([withBackend])) {
      assert.ok(!o.hint.includes('qwen3'), o.hint)
      assert.ok(!o.label.includes('qwen3'), o.label)
      assert.ok(!leaksInternalIdentifier(o.hint), o.hint)
    }
  })
})

describe('selection is refused for anything unavailable', () => {
  it('Automatic is always selectable', () => {
    assert.equal(selectable(CATALOG, undefined), true)
    assert.equal(selectable([], undefined), true)
  })

  it('an available family is selectable', () => {
    assert.equal(selectable(CATALOG, 'forge'), true)
  })

  it('🚨 a blocked family is not, however it was clicked', () => {
    for (const id of ['core', 'logic', 'swift', 'atlas']) {
      assert.equal(selectable(CATALOG, id), false, id)
    }
  })

  it('a family the catalog no longer offers is not', () => {
    // A stored choice can go stale; honouring it would resurrect a selection the
    // system can no longer serve, and the first sign would be a failed turn.
    assert.equal(selectable(CATALOG, 'retired-family'), false)
  })
})

describe('an empty or unread catalog', () => {
  it('still offers Automatic rather than an empty menu', () => {
    // An empty menu reads as "no models exist", which is a different and much
    // worse claim than "the catalog could not be read".
    const options = buildModelOptions([])
    assert.equal(options.length, 1)
    assert.equal(options[0]!.id, undefined)
    assert.equal(options[0]!.available, true)
  })

  it('every family blocked is still a full menu, not an empty one', () => {
    const allBlocked = CATALOG.filter((f) => !f.available)
    const options = buildModelOptions(allBlocked)
    assert.equal(options.length, allBlocked.length + 1)
    assert.equal(options.filter((o) => o.available).length, 1, 'only Automatic should be selectable')
  })
})
