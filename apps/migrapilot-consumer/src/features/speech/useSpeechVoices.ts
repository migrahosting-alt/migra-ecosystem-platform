'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

/**
 * Which voices this caller may actually be read aloud in.
 *
 * THE VOICES COME FROM THE BRAIN, never from a list here. The engine reports
 * what its speech runtime offers (today: Warm, Bright, Steady) along with the
 * one it defaults to, and a hardcoded copy in the browser would be wrong the
 * first time that runtime changed — offering a voice that no longer exists, or
 * hiding one that does.
 *
 * 🚨 A REFUSAL IS AN ANSWER. A signed-out visitor is not "unable to reach the
 * voice service": speech needs an account, which is a true, actionable sentence
 * the control can show. Conflating the two is what left a live Listen button on
 * every answer for people it could never work for.
 */
export interface SpeechVoice {
  id: string
  label: string
}

export interface SpeechCapability {
  ready: boolean
  voices: SpeechVoice[]
  defaultVoice?: string
  /** Why speech is unavailable. Empty when it IS available. */
  reason?: string
  /** True only when the refusal is about having an account, not about a fault. */
  requiresAccount?: boolean
}

/** Where the chosen voice is remembered. Device-local, like the model family. */
export const VOICE_STORAGE_KEY = 'migrapilot.speech.voice'

/**
 * The probe result, shared by every answer on screen.
 *
 * A module-level promise rather than a fetch per component: a long conversation
 * renders one Listen control PER ANSWER, and a hook that probed on mount would
 * ask the same question thirty times to render one row of buttons. Signing in
 * navigates the whole document, so there is no stale-after-login case for this
 * cache to get wrong.
 */
let probe: Promise<SpeechCapability> | null = null

const unreachable = (): SpeechCapability => ({
  ready: false,
  voices: [],
  reason: 'The voice service could not be reached.',
})

export function loadSpeechCapability(): Promise<SpeechCapability> {
  probe ??= fetch('/api/speech/speak', { credentials: 'same-origin' })
    .then(async (response) => {
      if (!response.ok) return unreachable()
      const data = (await response.json()) as SpeechCapability | null
      if (!data) return unreachable()
      return {
        ready: data.ready === true && Array.isArray(data.voices) && data.voices.length > 0,
        voices: Array.isArray(data.voices) ? data.voices : [],
        ...(data.defaultVoice ? { defaultVoice: data.defaultVoice } : {}),
        ...(data.reason ? { reason: data.reason } : {}),
        ...(data.requiresAccount ? { requiresAccount: true } : {}),
      }
    })
    .catch(() => unreachable())
  return probe
}

/** Test seam: forget the shared probe. Never called by the app. */
export function resetSpeechCapabilityForTests(): void {
  probe = null
}

/**
 * `null` means the probe has not answered yet — NOT that speech is unavailable.
 *
 * The control stays disabled either way, but the two must be described
 * differently: "checking" resolves on its own, "sign in" needs the user to act.
 */
export function useSpeechCapability(): SpeechCapability | null {
  const [capability, setCapability] = useState<SpeechCapability | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadSpeechCapability().then((value) => {
      if (!cancelled) setCapability(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return capability
}

/**
 * The one sentence explaining why an answer cannot be read aloud.
 *
 * Empty when it CAN be: a disabled control needs a reason, an enabled one needs
 * no excuse.
 */
export function speechDisabledReason(capability: SpeechCapability | null): string {
  if (!capability) return 'Checking whether answers can be read aloud…'
  if (capability.ready) return ''
  return capability.reason ?? 'Answers cannot be read aloud right now.'
}

/**
 * The voice to read with: the remembered one, else the Brain's default.
 *
 * A stored id that is no longer offered is DROPPED rather than sent. Voices are
 * a deployment detail of the speech runtime, so a choice made months ago can
 * name something that no longer exists — and sending it would fail the read for
 * a reason the user could not see or fix.
 */
export function resolveVoice(
  stored: string | null,
  capability: Pick<SpeechCapability, 'voices' | 'defaultVoice'>,
): string | undefined {
  const offered = capability.voices.some((voice) => voice.id === stored)
  if (stored && offered) return stored
  return capability.defaultVoice ?? capability.voices[0]?.id
}

/** Read the remembered voice. A browser that refuses storage still works. */
export function readStoredVoice(): string | null {
  try {
    return window.localStorage.getItem(VOICE_STORAGE_KEY)
  } catch {
    return null
  }
}

/** Remember a voice. Never throws — storage is a convenience, not the feature. */
export function storeVoice(id: string): void {
  try {
    window.localStorage.setItem(VOICE_STORAGE_KEY, id)
  } catch {
    /* a browser that refuses storage still gets a working picker */
  }
}

/* ------------------------------------------------------------------ *
 * The chosen voice, shared across every answer on screen
 * ------------------------------------------------------------------ */

/**
 * ONE selection, not one per answer.
 *
 * A conversation renders a Listen control per answer, and picking a voice on
 * any of them is a statement about how MigraPilot should read — not about that
 * paragraph. Component-local state would leave the other rows showing the old
 * voice until a reload, so the same screen would disagree with itself about a
 * choice the user just made.
 */
let chosen: string | null | undefined
const listeners = new Set<() => void>()

function chosenSnapshot(): string | null {
  if (chosen === undefined) chosen = readStoredVoice()
  return chosen
}

function subscribeChosenVoice(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Choose the voice for every answer, and remember it on this device. */
export function chooseVoice(id: string): void {
  chosen = id
  storeVoice(id)
  for (const listener of listeners) listener()
}

/** Test seam: forget the chosen voice. Never called by the app. */
export function resetChosenVoiceForTests(): void {
  chosen = undefined
}

/** The remembered voice, or null. `null` on the server — storage is per device. */
export function useChosenVoice(): string | null {
  return useSyncExternalStore(subscribeChosenVoice, chosenSnapshot, () => null)
}
