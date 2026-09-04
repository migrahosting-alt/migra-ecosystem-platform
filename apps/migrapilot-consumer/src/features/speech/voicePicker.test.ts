/**
 * Choosing the voice an answer is read in.
 *
 * THE GAP THIS CLOSES: the speech runtime has offered Warm, Bright and Steady
 * all along, and reported all three on every capability probe. Nothing in the
 * product let anyone pick one, so every answer was read in the default and the
 * other two were inventory rather than capability.
 *
 * The rules worth protecting are about HONESTY, not about the dropdown: a voice
 * that is no longer offered must not be sent, a refusal must not read as an
 * outage, and a control that cannot work must not look like one that can.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// `window` does not exist under the test runner; the storage helpers are
// deliberately written to survive that, and both directions are asserted below.
const memory = new Map<string, string>()
;(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
  },
}

const {
  resolveVoice,
  speechDisabledReason,
  readStoredVoice,
  storeVoice,
  VOICE_STORAGE_KEY,
} = await import('./useSpeechVoices')

const VOICES = [
  { id: 'warm', label: 'Warm' },
  { id: 'bright', label: 'Bright' },
  { id: 'steady', label: 'Steady' },
]

// ── which voice is actually used ────────────────────────────────────────────

test('a remembered voice that is still offered is the one used', () => {
  assert.equal(resolveVoice('bright', { voices: VOICES, defaultVoice: 'warm' }), 'bright')
})

test("🚨 a remembered voice the engine NO LONGER OFFERS is dropped, not sent", () => {
  /*
   * Voices are a deployment detail of the speech runtime. A choice made months
   * ago can name something that no longer exists, and sending it would fail the
   * read for a reason the user can neither see nor fix — while the picker sat
   * there showing a perfectly reasonable selection.
   */
  assert.equal(resolveVoice('velvet', { voices: VOICES, defaultVoice: 'warm' }), 'warm')
})

test('with nothing remembered, the ENGINE default is used — never a hardcoded one', () => {
  assert.equal(resolveVoice(null, { voices: VOICES, defaultVoice: 'steady' }), 'steady')
})

test('an engine that names no default falls back to the first voice it offers', () => {
  assert.equal(resolveVoice(null, { voices: VOICES }), 'warm')
})

test('no voices means no voice is sent at all', () => {
  assert.equal(resolveVoice('bright', { voices: [] }), undefined)
  assert.equal(resolveVoice(null, { voices: [] }), undefined)
})

// ── what the control says when it cannot work ───────────────────────────────

test('an unanswered probe reads as CHECKING, not as unavailable', () => {
  // The two need different words: one resolves itself, the other needs the user.
  assert.match(speechDisabledReason(null), /checking/i)
})

test('a working capability needs no excuse', () => {
  assert.equal(speechDisabledReason({ ready: true, voices: VOICES }), '')
})

test('🚨 a refusal is reported as a refusal, never as an outage', () => {
  const reason = speechDisabledReason({
    ready: false,
    voices: [],
    reason: 'Sign in to have answers read aloud.',
    requiresAccount: true,
  })
  assert.match(reason, /sign in/i)
  assert.doesNotMatch(reason, /could not be reached/i)
})

test('and a real outage keeps its own words', () => {
  assert.match(
    speechDisabledReason({ ready: false, voices: [], reason: 'The voice service could not be reached.' }),
    /could not be reached/i,
  )
})

test('an unavailable capability with no stated reason still says something true', () => {
  assert.notEqual(speechDisabledReason({ ready: false, voices: [] }), '')
})

// ── remembering the choice ──────────────────────────────────────────────────

test('a chosen voice is remembered on this device', () => {
  storeVoice('steady')
  assert.equal(memory.get(VOICE_STORAGE_KEY), 'steady')
  assert.equal(readStoredVoice(), 'steady')
})

test('a browser that refuses storage still gets a working picker', () => {
  const saved = (globalThis as unknown as { window: unknown }).window
  ;(globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: () => { throw new Error('storage disabled') },
      setItem: () => { throw new Error('storage disabled') },
    },
  }
  assert.doesNotThrow(() => storeVoice('warm'), 'remembering is a convenience, not the feature')
  assert.equal(readStoredVoice(), null)
  ;(globalThis as unknown as { window: unknown }).window = saved
})

// ── the wiring: comments may not satisfy any assertion below ────────────────

const src = (rel: string): string => {
  const raw = readFileSync(join(process.cwd(), 'src', ...rel.split('/')), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
const button = src('components/chat/SpeakButton.tsx')
const hook = src('features/speech/useSpeechVoices.ts')

test('THE DEAD CONTROL IS GONE: Listen is disabled whenever there is a reason', () => {
  assert.match(button, /disabled=\{state === 'preparing' \|\| Boolean\(unavailable\)\}/)
  // And the reason is readable, not just implied by a greyed-out button.
  assert.match(button, /title=\{\s*unavailable \? unavailable/)
  assert.match(button, /unavailable: \$\{unavailable\}/, 'a screen reader gets the reason too')
})

test('a refusal does not borrow the "waiting" cursor', () => {
  // `cursor-wait` says "this is in progress". A refusal is not in progress.
  assert.match(button, /unavailable \? 'cursor-not-allowed/)
})

test('the chosen voice is what gets sent', () => {
  assert.match(button, /body: JSON\.stringify\(\{ text, \.\.\.\(speaking \? \{ voice: speaking \} : \{\}\) \}\)/)
})

test('🚨 changing the voice discards audio synthesised in the old one', () => {
  /*
   * Replay reuses the cached clip rather than re-synthesising, so without this
   * the picker fails in the most convincing way there is: select Bright, press
   * Listen, hear Warm — and no error, because nothing failed.
   */
  const discard = button.slice(button.indexOf('const audio = audioRef.current'))
  assert.match(discard.slice(0, 400), /removeAttribute\('src'\)/)
  assert.match(discard.slice(0, 500), /\}, \[speaking\]\)/, 'keyed on the voice, so a change triggers it')
})

test('the picker appears only where speech works, and only with a real choice', () => {
  assert.match(button, /capability\?\.ready && capability\.voices\.length > 1 && \(/)
})

test('the picker is labelled for a screen reader', () => {
  assert.match(button, /htmlFor=\{voiceId\}/)
  assert.match(button, /Voice for reading answers/)
})

test('ONE probe for the whole screen, not one per answer', () => {
  /*
   * A long conversation renders a Listen control per answer. A probe on mount
   * would ask the same question thirty times to draw one row of buttons.
   */
  assert.match(hook, /probe \?\?= fetch\('\/api\/speech\/speak'/)
})

test('the voices are never hardcoded in the browser', () => {
  for (const invented of ['Warm', 'Bright', 'Steady']) {
    assert.doesNotMatch(hook, new RegExp(`'${invented}'`), `${invented} must come from the engine`)
    assert.doesNotMatch(button, new RegExp(`'${invented}'`))
  }
})
