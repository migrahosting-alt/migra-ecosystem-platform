// The consumer's Migra model selector.
//
// Two properties matter most: a remembered choice must not resurrect a family
// the system can no longer honour, and this surface must never grow its own
// idea of what the families are.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { restoreSelection, defaultSelection, type MigraFamilyView } from './useModelFamilies'
import { MIGRA_FAMILY_IDS, MIGRA_MODEL_FAMILIES } from '@migrapilot/shared-types/model-families'

const family = (id: string, over: Partial<MigraFamilyView> = {}): MigraFamilyView => ({
  id,
  displayName: id,
  tagline: 'does things',
  description: 'd',
  recommended: false,
  available: true,
  governed: false,
  ...over,
})

test('a remembered choice is restored when it is still available', () => {
  const fams = [family('migra-forge'), family('migra-core', { recommended: true })]
  assert.equal(restoreSelection('migra-forge', fams), 'migra-forge')
})

test('a remembered choice that became UNAVAILABLE is not resurrected', () => {
  // The exact regression: a family selectable yesterday, blocked today. Restoring
  // it silently would surface as a failed turn rather than an honest selector.
  const fams = [family('migra-forge', { available: false, unavailableReason: 'model retired' })]
  assert.equal(restoreSelection('migra-forge', fams), undefined)
})

test('a remembered choice that no longer EXISTS is not restored', () => {
  assert.equal(restoreSelection('migra-obsolete', [family('migra-core')]), undefined)
})

test('nothing remembered means the recommended family, when it is available', () => {
  const fams = [family('migra-core', { recommended: true }), family('migra-forge')]
  assert.equal(defaultSelection(fams), 'migra-core')
})

test('an UNAVAILABLE recommended family does not silently promote another', () => {
  // Falling through to Forge here would be the product choosing for the user and
  // calling it a default.
  const fams = [family('migra-core', { recommended: true, available: false }), family('migra-forge')]
  assert.equal(defaultSelection(fams), undefined)
})

// ── the cross-surface guard ────────────────────────────────────────────────

// Resolved from the package root: __dirname is not defined in this ESM test
// context, and a module-level throw there silently truncates the suite.
const SRC = join(process.cwd(), 'src', 'features', 'models', 'ModelFamilySelector.tsx')
const HOOK = join(process.cwd(), 'src', 'features', 'models', 'useModelFamilies.ts')
const selector = readFileSync(SRC, 'utf8')
const hook = readFileSync(HOOK, 'utf8')

test('the consumer defines NO family names of its own', () => {
  // Every canonical id must be absent as a literal: the list comes from the
  // server. A hard-coded name here is the first step to two products describing
  // Migra Forge differently.
  const leaked = MIGRA_FAMILY_IDS.filter((id) => selector.includes(`'${id}'`) || hook.includes(`'${id}'`))
  assert.deepEqual(leaked, [], 'the consumer hard-codes family ids instead of reading the catalog')
})

test('the consumer defines NO family descriptions of its own', () => {
  // Checked as STRING LITERALS, not as substrings: naming Migra Forge in a
  // comment explains the code, whereas `'Migra Forge'` in it is a second
  // definition that will drift from the catalog. Only the latter is a defect.
  const literal = (v: string): boolean => selector.includes(`'${v}'`) || selector.includes(`"${v}"`)
  for (const id of MIGRA_FAMILY_IDS) {
    const f = MIGRA_MODEL_FAMILIES[id]
    assert.equal(literal(f.tagline), false, `${id} tagline is hard-coded in the consumer`)
    assert.equal(literal(f.displayName), false, `${id} display name is hard-coded in the consumer`)
    assert.equal(literal(f.description), false, `${id} description is hard-coded in the consumer`)
  }
})

test('no backend model or provider name appears in the consumer selector', () => {
  for (const re of [/qwen[0-9.]*[-:]/i, /deepseek-r1/i, /llama3/i, /minicpm/i, /llava/i, /gpt-oss/i, /ollama/i, /runpod/i]) {
    assert.doesNotMatch(selector, re, `a backend name matching ${re} leaked into the selector`)
    assert.doesNotMatch(hook, re, `a backend name matching ${re} leaked into the hook`)
  }
})

const options = readFileSync(join(process.cwd(), 'src/features/models/modelOptions.ts'), 'utf8')

test('the selector renders the availability REASON, never just hides a family', () => {
  // The reason moved into the option model when the picker moved into the
  // composer, but the property is unchanged: it must reach the user, and an
  // unavailable family must not be filtered out of the list.
  assert.match(options, /unavailableNote/, 'the reason must reach the user')
  assert.match(options, /status: 'unavailable'/, 'unavailable families must be marked as such')
  assert.doesNotMatch(options, /families\.filter\(\(f\) => f\.available\)/, 'unavailable families must stay visible')
  assert.doesNotMatch(selector, /families\.filter\(\(f\) => f\.available\)/, 'unavailable families must stay visible')
})

test('an unavailable family cannot be selected even if the event fires', () => {
  assert.match(selector, /if \(!selectable\(families, id\)\) return/)
  // aria-disabled, not disabled: a natively disabled row is skipped by keyboard
  // focus, which would make the blocked families the one thing a keyboard user
  // could never read the reason for — in the only place the reason is shown.
  assert.match(selector, /aria-disabled=\{blocked\}/)
  assert.doesNotMatch(selector, /\n\s*disabled=\{blocked\}/)
})

test('🚨 the unavailable REASONS render only inside the opened menu', () => {
  /*
   * THE DEFECT THIS PINS. The chat page printed four governance sentences
   * permanently above the composer — "Migra Core isn't available yet", and three
   * more — on every turn, forever. True, and the loudest thing on a page that
   * exists for typing a message.
   *
   * The distinction is preserved, not softened: families stay listed and stay
   * unselectable with their real reason. What is pinned here is WHEN the reason
   * is allowed to render.
   */
  for (const screen of ['screens/ChatPage.tsx', 'screens/WelcomePage.tsx']) {
    const src = readSrc(screen)
    assert.doesNotMatch(src, /unavailableReason|unavailableNote|humanUnavailableReason/, `${screen} renders a governance reason on the page`)
    assert.doesNotMatch(src, /isn.t available yet/, `${screen} hard-codes an unavailability sentence`)
  }

  // And in the selector itself, every reason sits inside the `open &&` branch.
  const openBranch = selector.slice(selector.indexOf('{open && ('))
  assert.ok(openBranch.length > 0, 'the menu is no longer conditional on `open`')
  assert.match(openBranch, /option\.hint/, 'the reason is not rendered inside the opened menu')
  const beforeMenu = selector.slice(0, selector.indexOf('{open && ('))
  assert.doesNotMatch(beforeMenu, /option\.hint/, 'a reason renders before the menu opens')
})

test('the collapsed control says only Automatic or the chosen family', () => {
  // Status in the closed state would put the same four sentences back on the
  // page in a shorter form.
  assert.match(selector, /collapsedLabel\(families, selected\)/)
  assert.doesNotMatch(selector, /Unavailable.*collapsed|collapsed.*Unavailable/i)
})

// ── the field must actually reach the wire ─────────────────────────────────
//
// seams.ts warns from experience that "a field added at one end is silently
// discarded by the next: excess properties are not checked through a spread, so
// the omission compiles and the tests pass while the value never reaches the
// wire." A selector that appears to work while every turn routes automatically
// is precisely that failure, so each hop is asserted.

const readSrc = (rel: string): string => readFileSync(join(process.cwd(), 'src', ...rel.split('/')), 'utf8')

test('modelFamily is declared and forwarded at EVERY hop to the Brain', () => {
  const hops: Array<[string, RegExp]> = [
    ['state/ChatProvider.tsx', /modelFamily\?: string/],
    ['state/ChatProvider.tsx', /\{ modelFamily \}/],
    // BOTH entry points. Only sendMessage was covered, so the FIRST turn — the
    // one a new visitor actually sends — dropped the family while every test
    // passed and the answer came back looking correct.
    ['state/ChatProvider.tsx', /appendReply\(id, prompt,[^)]*options\?\.modelFamily\)/],
    ['state/ChatProvider.tsx', /appendReply\(conversationId, prompt,[^)]*options\?\.modelFamily\)/],
    ['screens/WelcomePage.tsx', /modelFamily \? \{ modelFamily \}/],
    ['screens/ChatPage.tsx', /modelFamily \? \{ modelFamily \}/],
    ['app/api/chat/stream/route.ts', /const modelFamily =/],
    ['app/api/chat/stream/route.ts', /\.\.\.\(modelFamily \? \{ modelFamily \} : \{\}\)/],
    ['server/brain/seams.ts', /modelFamily\?: string/],
    ['server/brain/seams.ts', /options\.modelFamily \? \{ modelFamily: options\.modelFamily \}/],
    ['server/brain/operations.ts', /modelFamily\?: string/],
    ['server/brain/operations.ts', /op\.modelFamily \? \{ modelFamily: op\.modelFamily \}/],
  ]
  const missing = hops
    .filter(([file, re]) => !re.test(readSrc(file)))
    .map(([file, re]) => `${file} :: ${re.source}`)
  assert.deepEqual(missing, [], 'modelFamily is dropped at one of these hops and never reaches the Brain')
})

test('the selector is actually mounted, through the composer', () => {
  /*
   * A component nobody renders passes every unit test it has. There are TWO hops
   * now that the picker lives inside the composer: the Composer must render it,
   * and each screen must pass the handler that opts into offering the choice.
   * Miss the second and the picker silently disappears from the product while
   * every test here still passes.
   */
  assert.match(readSrc('components/chat/Composer.tsx'), /<ModelFamilySelector/)
  for (const screen of ['screens/ChatPage.tsx', 'screens/WelcomePage.tsx']) {
    assert.match(readSrc(screen), /onModelFamilyChange=\{setModelFamily\}/, `${screen} does not offer the picker`)
  }
})
