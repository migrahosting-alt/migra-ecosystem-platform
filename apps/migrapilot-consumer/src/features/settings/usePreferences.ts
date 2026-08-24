'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { announceAppearance } from '@/features/appearance/AppearanceProvider'
import {
  DEFAULT_PREFERENCES,
  type UserPreferences,
} from '@migrapilot/shared-types/user-preferences'

/**
 * The user's preferences, optimistic but never dishonest.
 *
 * THE RULE THIS ENFORCES: a control may move immediately, and it may only STAY
 * moved if the server agreed. A settings toggle that flips, looks saved, and is
 * forgotten on reload is worse than one that admits it is not wired up — the
 * user only discovers the truth later, after trusting it.
 *
 * So every save reconciles against the FULL document the server returns, not
 * against what was sent. A value the server clamped, rejected or normalised
 * comes back as the value actually stored, and the screen follows it. On
 * failure the previous value is restored and the error is surfaced — the
 * control visibly goes back, which is the only honest way to show that nothing
 * was saved.
 */

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; at: number }
  | { status: 'error'; message: string }

export interface PreferencesController {
  preferences: UserPreferences
  /** True until the first read completes. Controls should not be trusted before. */
  loading: boolean
  /** False when these are defaults nobody has chosen yet. */
  stored: boolean
  /** Null until known; a failed READ must not look like a successful empty one. */
  loadError: string | null
  save: SaveState
  /** Change one preference. Optimistic, reconciled, rolled back on refusal. */
  set: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => Promise<boolean>
  /** Change several at once — one request, one audit entry. */
  setMany: (patch: Partial<UserPreferences>) => Promise<boolean>
  reload: () => void
}

export function usePreferences(): PreferencesController {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES)
  const [loading, setLoading] = useState(true)
  const [stored, setStored] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [save, setSave] = useState<SaveState>({ status: 'idle' })
  /** Mirrors state so a save can roll back to the value that was really current. */
  const current = useRef<UserPreferences>(DEFAULT_PREFERENCES)
  current.current = preferences

  const read = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/preferences', { cache: 'no-store' })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null
        /*
         * A FAILED READ IS NOT AN EMPTY ONE. Falling back to defaults silently
         * would render every control at its default and invite the user to
         * "change" settings that are actually unreadable — and the first save
         * would then overwrite whatever is really stored.
         */
        setLoadError(body?.message ?? 'Your settings could not be loaded.')
        return
      }
      const body = (await response.json()) as { preferences: UserPreferences; stored: boolean }
      setPreferences(body.preferences)
      setStored(body.stored)
      setLoadError(null)
    } catch {
      setLoadError('Your settings could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void read()
  }, [read])

  const setMany = useCallback(async (patch: Partial<UserPreferences>): Promise<boolean> => {
    const previous = current.current
    // Optimistic: the control moves now.
    setPreferences((p) => ({ ...p, ...patch }))
    setSave({ status: 'saving' })

    try {
      const response = await fetch('/api/preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null
        // Back to where it was. The control visibly returns, because it did not save.
        setPreferences(previous)
        setSave({ status: 'error', message: body?.message ?? 'That change could not be saved.' })
        return false
      }

      const body = (await response.json()) as { preferences: UserPreferences }
      /*
       * RECONCILE AGAINST THE SERVER, not against the patch. If it clamped
       * retention or rejected a value, this is where the screen learns — rather
       * than showing what was asked for until the next reload disagrees.
       */
      setPreferences(body.preferences)
      setStored(true)
      /*
       * Applied from what the SERVER stored, not from the patch — the same rule
       * the rest of this hook follows. Announced rather than set directly so the
       * appearance system stays independent of this screen being mounted.
       */
      announceAppearance(body.preferences)
      setSave({ status: 'saved', at: Date.now() })
      return true
    } catch {
      setPreferences(previous)
      setSave({ status: 'error', message: 'That change could not be saved. Check your connection.' })
      return false
    }
  }, [])

  const set = useCallback(
    <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) =>
      setMany({ [key]: value } as Partial<UserPreferences>),
    [setMany],
  )

  return {
    preferences,
    loading,
    stored,
    loadError,
    save,
    set,
    setMany,
    reload: () => void read(),
  }
}
