/**
 * The Migra model selector.
 *
 * Shows PRODUCT identities — Migra Core, Migra Forge — and never the model
 * behind them. The backend id travels in the payload for provenance and is
 * deliberately not rendered: which model serves a family is a governance
 * decision that must stay replaceable without the UI noticing.
 *
 * An unavailable family stays VISIBLE and disabled, with the real reason. Hiding
 * it would look like the capability never existed, and a user wondering where
 * Migra Atlas went deserves to read why rather than doubt their memory.
 */

'use client'

import { useEffect, useState } from 'react'

import { humanUnavailableReason } from './unavailableReason'
import {
  useModelFamilies,
  restoreSelection,
  defaultSelection,
  FAMILY_STORAGE_KEY,
  type MigraFamilyView,
} from './useModelFamilies'

export interface ModelFamilySelectorProps {
  /** Called with the family id, or undefined to let the server route. */
  onChange?: (familyId: string | undefined) => void
  className?: string
}

/**
 * A short, honest note for a family that cannot be chosen.
 *
 * Translated, never passed through: the resolver's reasons name the internal
 * governed capability, and rendering them verbatim put `chat.general` and three
 * more like it in front of users.
 */
function unavailableNote(f: MigraFamilyView): string {
  return humanUnavailableReason(f)
}

export function ModelFamilySelector({ onChange, className }: ModelFamilySelectorProps) {
  const state = useModelFamilies()
  const [selected, setSelected] = useState<string | undefined>(undefined)

  // Restore only a choice that is still OFFERED and still AVAILABLE.
  useEffect(() => {
    if (state.phase !== 'ready') return
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(FAMILY_STORAGE_KEY)
    } catch {
      stored = null
    }
    const next = restoreSelection(stored, state.families) ?? defaultSelection(state.families)
    setSelected(next)
    onChange?.(next)
    // Only when the catalog itself changes.
  }, [state.phase, state.phase === 'ready' ? state.catalogRevision : ''])

  if (state.phase === 'loading') {
    return (
      <div className={className} aria-busy="true">
        <span className="text-sm opacity-70">Loading models…</span>
      </div>
    )
  }

  if (state.phase === 'error') {
    // Fail closed and visibly. An empty dropdown reads as "no models exist".
    return (
      <div className={className} role="alert">
        <span className="text-sm text-red-600">{state.message}</span>{' '}
        <button type="button" className="text-sm underline" onClick={state.reload}>
          Retry
        </button>
      </div>
    )
  }

  const choose = (id: string): void => {
    const family = state.families.find((f) => f.id === id)
    if (!family || !family.available) return // never select an unavailable family
    setSelected(id)
    try {
      window.localStorage.setItem(FAMILY_STORAGE_KEY, id)
    } catch {
      // A browser that refuses storage still gets a working selector.
    }
    onChange?.(id)
  }

  return (
    <div className={className}>
      <label htmlFor="migra-model-family" className="sr-only">
        Model
      </label>
      <select
        id="migra-model-family"
        value={selected ?? ''}
        onChange={(e) => choose(e.target.value)}
        className="rounded border px-2 py-1 text-sm"
      >
        {!selected && <option value="">Automatic</option>}
        {state.families.map((f) => (
          <option
            key={f.id}
            value={f.id}
            disabled={!f.available}
            title={f.available ? f.tagline : unavailableNote(f)}
          >
            {f.displayName}
            {f.recommended ? ' — Recommended' : ''} · {f.tagline}
            {f.available ? '' : ' (unavailable)'}
          </option>
        ))}
      </select>

      {/* The reason a disabled family cannot be chosen, in the open. */}
      {state.families.some((f) => !f.available) && (
        <ul className="mt-1 space-y-0.5 text-xs opacity-70">
          {state.families
            .filter((f) => !f.available)
            .map((f) => (
              // The sentence already names the family, so the name is not
              // repeated ahead of it.
              <li key={f.id}>{unavailableNote(f)}</li>
            ))}
        </ul>
      )}
    </div>
  )
}
