'use client'

import { useState } from 'react'
import { ThumbsDown, ThumbsUp, Loader2 } from 'lucide-react'

/**
 * What did you think of this answer?
 *
 * 🚨 THE STATE SHOWN IS THE STATE STORED. These buttons previously held their
 * value in `useState` with no route behind them, so a vote looked recorded,
 * vanished on reload, and never reached anything that could learn from it. The
 * selected state here is passed in from the persisted record and only changes
 * after the write succeeds.
 *
 * A FAILED WRITE LEAVES NOTHING SELECTED. That is the whole point: the previous
 * version could not fail, because it never tried. Now it can, and when it does it
 * says so and offers the click again rather than painting a saved state over an
 * error.
 *
 * NEGATIVE FEEDBACK ASKS WHY. One click is a mood; a reason is evidence. The
 * vote is saved on the first click either way — if someone closes the reason
 * panel without choosing, their "this was bad" is still recorded, because losing
 * it would punish them for not elaborating.
 */

export type Rating = 'up' | 'down'

export interface FeedbackState {
  rating: Rating
  reason?: string
  detail?: string
}

const REASONS: { id: string; label: string }[] = [
  { id: 'incorrect', label: 'Incorrect' },
  { id: 'misunderstood_request', label: 'Misunderstood my request' },
  { id: 'poor_quality', label: 'Poor quality' },
  { id: 'unsafe_or_unhelpful', label: 'Unsafe or unhelpful' },
  { id: 'tool_failure', label: 'Something failed' },
  { id: 'other', label: 'Other' },
]

export function FeedbackControls({
  current,
  busy,
  problem,
  onVote,
  onRetract,
  onDetail,
}: {
  current?: FeedbackState
  busy?: boolean
  problem?: string | null
  onVote: (rating: Rating) => void
  onRetract: () => void
  onDetail: (reason: string, detail?: string) => void
}) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [note, setNote] = useState('')

  const press = (rating: Rating) => {
    if (busy) return
    // Pressing the SAME thumb again withdraws it. One control, three states, no
    // separate "undo" affordance to explain.
    if (current?.rating === rating) {
      setPanelOpen(false)
      onRetract()
      return
    }
    onVote(rating)
    setPanelOpen(rating === 'down')
  }

  const btn = (rating: Rating, Icon: typeof ThumbsUp, label: string) => {
    const active = current?.rating === rating
    return (
      <button
        type="button"
        aria-label={active ? `${label} — selected, click to withdraw` : label}
        aria-pressed={active}
        title={label}
        disabled={busy}
        onClick={() => press(rating)}
        className={
          'rounded-md p-1.5 transition-colors disabled:cursor-wait focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400 ' +
          (active
            ? 'bg-brand-50 text-brand-600'
            : 'text-slate-400 hover:bg-raised hover:text-slate-600')
        }
      >
        {busy && current?.rating === rating ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
        ) : (
          <Icon className={'h-4 w-4' + (active ? ' fill-current' : '')} strokeWidth={1.8} />
        )}
      </button>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1">
        {btn('up', ThumbsUp, 'Good response')}
        {btn('down', ThumbsDown, 'Bad response')}
      </div>

      {problem && (
        <span className="text-[12px] text-amber-700" role="status">
          {problem}
        </span>
      )}

      {panelOpen && current?.rating === 'down' && (
        <div className="mt-1 w-full max-w-[380px] rounded-lg border border-hairline bg-raised p-3">
          <p className="mb-2 text-[12.5px] font-medium text-slate-600">
            What went wrong? <span className="font-normal text-slate-400">Optional</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onDetail(r.id, note.trim() || undefined)}
                className={
                  'rounded-md border px-2 py-1 text-[12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-400 ' +
                  (current.reason === r.id
                    ? 'border-brand-300 bg-brand-50 text-brand-700'
                    : 'border-hairline text-slate-600 hover:border-brand-200')
                }
              >
                {r.label}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 2000))}
            placeholder="Anything else? (optional)"
            rows={2}
            className="mt-2 w-full resize-none rounded-md border border-hairline bg-canvas px-2 py-1.5 text-[12.5px] text-slate-700 placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="rounded-md px-2 py-1 text-[12px] text-slate-500 hover:text-slate-700"
            >
              Done
            </button>
            <button
              type="button"
              disabled={!current.reason && !note.trim()}
              onClick={() => {
                onDetail(current.reason ?? 'other', note.trim() || undefined)
                setPanelOpen(false)
              }}
              className="rounded-md bg-brand-600 px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
