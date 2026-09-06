/**
 * The Migra model selector — a control inside the composer, not a banner above it.
 *
 * Shows PRODUCT identities — Migra Core, Migra Forge — and never the model behind
 * them. The backend id travels in the payload for provenance and is deliberately
 * not rendered: which model serves a family is a governance decision that must
 * stay replaceable without the UI noticing.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THIS STOPPED BEING A FULL-WIDTH SELECT
 *
 * The old layout printed every unavailable family's reason PERMANENTLY on the
 * chat page, stacked under a full-width dropdown:
 *
 *     Migra Core isn't available yet — no model has been approved for it.
 *     Migra Logic isn't available yet — no model has been approved for it.
 *     Migra Swift isn't available yet — no model has been approved for it.
 *     Migra Atlas isn't available yet — no model has been approved for it.
 *
 * Four lines of governance state above the input box, on every turn, forever.
 * Each sentence was true and the honesty was the point — but repeated four times
 * where a person is trying to type, it reads as a system in trouble rather than
 * as a deliberate, governed state. It also pushed the composer down the screen
 * and made the picker the loudest thing on a page that exists for the message.
 *
 * THE DISTINCTION IS PRESERVED, NOT SOFTENED. Unavailable families are still
 * listed, still unselectable, and still carry the real reason. What changed is
 * WHEN: the reason renders when the menu is open — at the moment someone is
 * choosing — instead of permanently at everyone. Hiding a family would look like
 * the capability never existed, and a user wondering where Migra Atlas went
 * deserves to read why rather than doubt their memory.
 * ---------------------------------------------------------------------------
 */

'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check, Sparkles } from 'lucide-react'

import { cn } from '@/lib/cn'

import { buildModelOptions, collapsedLabel, selectable } from './modelOptions'
import {
  useModelFamilies,
  restoreSelection,
  defaultSelection,
  FAMILY_STORAGE_KEY,
} from './useModelFamilies'

export interface ModelFamilySelectorProps {
  /** Called with the family id, or undefined to let the server route. */
  onChange?: (familyId: string | undefined) => void
  className?: string
}

export function ModelFamilySelector({ onChange, className }: ModelFamilySelectorProps) {
  const state = useModelFamilies()
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const wrapper = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = useRef<Array<HTMLButtonElement | null>>([])

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

  /*
   * Dismissal. A menu that can only be closed by clicking away is a trap for
   * anyone not using a mouse, so Escape closes it AND returns focus to the
   * trigger — otherwise focus is left on a node that no longer exists and the
   * next Tab starts from the top of the document.
   */
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  /*
   * 🚨 CLAMP THE MENU TO THE SPACE THAT ACTUALLY EXISTS.
   *
   * Measured at 390px: the menu ran off the right edge of the screen. A width of
   * `min(21rem, 100vw - 2.5rem)` looks safe until you remember the menu is
   * anchored to a control that is itself indented — page padding, composer
   * padding, the attachment button, the gap. Subtracting a guessed inset is how
   * that guess goes wrong on the next layout change, so the distance is measured
   * from the trigger's real position instead.
   */
  const [menuMax, setMenuMax] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (!open) return
    const el = wrapper.current
    if (!el) return
    const measure = (): void => {
      const { left } = el.getBoundingClientRect()
      // 12px of breathing room at the right edge, and never so narrow that a
      // reason becomes unreadable.
      setMenuMax(Math.max(220, window.innerWidth - left - 12))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  // Move real focus with the active index, so a screen reader announces the row
  // it lands on — including a disabled one, which is the row carrying the reason.
  useEffect(() => {
    if (!open) return
    items.current[activeIndex]?.focus()
  }, [open, activeIndex])

  const families = state.phase === 'ready' ? state.families : []

  const options = buildModelOptions(families)

  const choose = (id: string | undefined): void => {
    // Never select an unavailable family, whatever the row was doing.
    if (!selectable(families, id)) return
    setSelected(id)
    try {
      if (id) window.localStorage.setItem(FAMILY_STORAGE_KEY, id)
      else window.localStorage.removeItem(FAMILY_STORAGE_KEY)
    } catch {
      // A browser that refuses storage still gets a working selector.
    }
    onChange?.(id)
    setOpen(false)
    trigger.current?.focus()
  }

  /** Roving focus. Disabled rows are INCLUDED so their reason can be read. */
  const onMenuKey = (event: React.KeyboardEvent): void => {
    const last = options.length - 1
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => (i >= last ? 0 : i + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => (i <= 0 ? last : i - 1))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActiveIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActiveIndex(last)
    } else if (event.key === 'Tab') {
      // Tabbing out of an open menu closes it rather than leaving it hanging
      // over the composer while focus moves on.
      setOpen(false)
    }
  }

  const openMenu = (startAtEnd = false): void => {
    const currentIndex = options.findIndex((o) => o.id === selected)
    setActiveIndex(startAtEnd ? options.length - 1 : currentIndex >= 0 ? currentIndex : 0)
    setOpen(true)
  }

  const onTriggerKey = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openMenu(event.key === 'ArrowUp')
    }
  }

  const label =
    state.phase === 'loading'
      ? 'Models…'
      : state.phase === 'error'
        ? 'Models unavailable'
        : collapsedLabel(families, selected)

  /*
   * A pill, sized and shaped like the composer's other controls so it reads as
   * one of them rather than as a form field that wandered in. It stays at least
   * 36px tall for touch, and its text truncates instead of widening the row.
   */
  const pill = cn(
    'inline-flex h-9 max-w-[11rem] items-center gap-1.5 rounded-lg border px-2.5',
    'text-[13px] font-medium transition',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
    state.phase === 'error'
      ? 'border-amber-300 text-amber-700 hover:border-amber-400'
      : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-800',
    open && 'border-brand-400 bg-brand-50 text-brand-600',
  )

  return (
    <div ref={wrapper} className={cn('relative', className)}>
      <button
        ref={trigger}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onTriggerKey}
        disabled={state.phase === 'loading'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Model: ${label}. Choose a Migra model.`}
        title="Choose a Migra model"
        className={pill}
      >
        <Sparkles className="h-[15px] w-[15px] shrink-0" strokeWidth={1.9} aria-hidden="true" />
        <span className="truncate">{label}</span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Migra models"
          onKeyDown={onMenuKey}
          /*
           * Opens UPWARD: the composer sits at the bottom of the viewport, and a
           * downward menu would be clipped off-screen on a phone. Width is capped
           * to the viewport so a long reason cannot push the layout sideways, and
           * the list scrolls rather than growing past the top of the screen.
           */
          style={menuMax === undefined ? undefined : { maxWidth: `${menuMax}px` }}
          className="absolute bottom-11 left-0 z-30 max-h-[min(22rem,60vh)] w-[21rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {state.phase === 'error' && (
            /*
             * Fail closed and VISIBLY. An empty menu reads as "no models exist",
             * which is a different and much worse claim than "we could not read
             * the catalog".
             */
            <div role="alert" className="px-3.5 py-3">
              <p className="text-[13px] text-red-600">{state.message}</p>
              <button
                type="button"
                onClick={() => {
                  state.reload()
                  setOpen(false)
                }}
                className="mt-1.5 text-[13px] font-medium text-brand-600 underline"
              >
                Try again
              </button>
            </div>
          )}

          {options.map((option, index) => {
            const isSelected = option.id === selected
            const blocked = !option.available
            return (
              <button
                key={option.id ?? '__automatic'}
                ref={(el) => {
                  items.current[index] = el
                }}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                /*
                 * `aria-disabled`, NOT `disabled`. A natively disabled button is
                 * skipped by keyboard focus and by many screen readers — which
                 * would make the unavailable families the one thing a keyboard
                 * user could never read the reason for, in the only place the
                 * reason is now shown.
                 */
                aria-disabled={blocked}
                tabIndex={index === activeIndex ? 0 : -1}
                onClick={() => {
                  if (blocked) return
                  choose(option.id)
                }}
                onFocus={() => setActiveIndex(index)}
                className={cn(
                  'flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition',
                  'focus-visible:outline-none focus-visible:bg-slate-100',
                  blocked ? 'cursor-not-allowed opacity-60' : 'hover:bg-slate-50',
                )}
              >
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                  {isSelected && <Check className="h-4 w-4 text-brand-600" strokeWidth={2.4} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[14px] font-medium text-slate-800">{option.label}</span>
                    {option.recommended && option.available && (
                      <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-600">
                        Recommended
                      </span>
                    )}
                    {blocked && (
                      // The STATUS, beside the name. The sentence below says why.
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                        Unavailable
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-slate-500">
                    {option.hint}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
