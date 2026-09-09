'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, Globe, ImageIcon, Mail, Paperclip } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * What the paperclip actually offers.
 *
 * IT WAS A GUESS BEFORE. One unlabelled paperclip opened a file picker, and a
 * user with a photo had no way to learn that MigraPilot could read it — the
 * capability shipped, qualified and governed, and stayed undiscoverable. An icon
 * is not an affordance if it does not say what it does.
 *
 * ONLY REAL ACTIONS APPEAR. An entry that opens nothing teaches people to
 * distrust the menu, so an action whose capability is unavailable is shown
 * DISABLED WITH THE REASON rather than hidden or left to fail on click. Hiding it
 * would be its own lie: "MigraPilot cannot read images" and "MigraPilot cannot
 * read images right now" are different facts, and the second one is temporary.
 */

export interface HubAction {
  id: string
  label: string
  hint: string
  icon: 'image' | 'file' | 'globe' | 'mail'
  /** Disabled when set; shown verbatim, because the server knows why. */
  unavailableReason?: string
  /**
   * A fix the USER can perform, here, right now.
   *
   * 🚨 THE DIFFERENCE BETWEEN A DEAD ROW AND A LIVE ONE.
   *
   * "Email is not connected yet" and "Email is unavailable right now" are both
   * reasons, and only the first has anything a person can do about it. A row
   * with a reason and no remedy stays disabled, because offering a control that
   * cannot help is how a menu teaches people to stop reading it. A row WITH a
   * remedy stays clickable — and clicking it runs the remedy, never the action
   * the row is named after.
   */
  remedy?: { label: string; onSelect: () => void }
  onSelect: () => void
}

const ICONS = { image: ImageIcon, file: FileText, globe: Globe, mail: Mail }

/**
 * One row.
 *
 * Exported so its behaviour can be RENDERED in a test rather than asserted
 * against this file's source. A menu that only opens on click is a menu whose
 * claims get checked with regexes, and a regex over source is not evidence
 * about what a user sees.
 */
export function HubRow({ action, onDone }: { action: HubAction; onDone: () => void }) {
  const Icon = ICONS[action.icon]
  /*
   * Blocked means blocked with NO way out. A reason plus a remedy is not
   * blocked — it is a different, smaller action.
   */
  const blocked = Boolean(action.unavailableReason) && !action.remedy
  const remedy = action.unavailableReason ? action.remedy : undefined

  return (
    <button
      type="button"
      role="menuitem"
      disabled={blocked}
      onClick={() => {
        if (blocked) return
        onDone()
        // The remedy WINS when present. Running the row's own action here would
        // start something the capability has already said it cannot do.
        if (remedy) remedy.onSelect()
        else action.onSelect()
      }}
      title={action.unavailableReason}
      className={cn(
        'flex w-full items-start gap-3 px-3.5 py-3 text-left transition',
        blocked ? 'cursor-not-allowed opacity-55' : 'hover:bg-slate-50',
      )}
    >
      <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-slate-500" strokeWidth={1.9} />
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-slate-800">{action.label}</span>
        {/* The reason REPLACES the hint when unavailable: showing what it would
            do beside why it cannot is how a dead control reads. */}
        <span className="mt-0.5 block text-[12.5px] leading-snug text-slate-500">
          {action.unavailableReason ?? action.hint}
        </span>
        {remedy && (
          /*
           * Named as the thing that will happen, not "Fix" or "Retry". The row
           * says Email, the reason says it is not connected, and this says
           * Connect — so the outcome of pressing is legible before pressing.
           */
          <span className="mt-1 inline-block text-[12.5px] font-medium text-brand-600">
            {remedy.label}
          </span>
        )}
      </span>
    </button>
  )
}

export function ActionHub({ actions, disabled, disabledReason, className }: {
  actions: HubAction[]
  disabled?: boolean
  disabledReason?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    // Escape closes too: a menu that can only be dismissed by clicking away is a
    // trap for anyone not using a mouse.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapper} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={disabled ? disabledReason : 'Add a photo or a file'}
        aria-label="Add a photo or a file"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition',
          'hover:border-slate-300 hover:text-slate-700',
          open && 'border-brand-400 bg-brand-50 text-brand-600',
          disabled && 'cursor-not-allowed opacity-40',
        )}
      >
        <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.9} />
      </button>

      {open && (
        <div
          role="menu"
          /*
           * Opens UPWARD: the composer sits at the bottom of the viewport, and a
           * downward menu would be clipped off-screen on a phone. Width is capped
           * to the viewport so a long reason cannot push the layout sideways.
           */
          className="absolute bottom-11 left-0 z-30 w-[min(19rem,calc(100vw-2.5rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
        >
          {actions.map((action) => (
            <HubRow key={action.id} action={action} onDone={() => setOpen(false)} />
          ))}
        </div>
      )}
    </div>
  )
}
