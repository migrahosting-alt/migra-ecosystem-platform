'use client'

import { AlertTriangle, Check, Mic, RotateCw, Square, X } from 'lucide-react'
import type { TranscriptionResult } from '@migrapilot/shared-types/transcription'
import type { RecorderState, VoiceError } from './useVoiceRecorder'
import { cn } from '@/lib/cn'

/**
 * What the user sees while dictating, and before a transcript becomes their words.
 *
 * NOTHING IS AUTO-SENT. A transcript always passes through the user — a clean one is
 * inserted into the composer for them to send, and an uncertain one has to be accepted
 * explicitly with the reasons visible. A fluent sentence is not proof the system heard
 * them, so the decision stays theirs.
 *
 * The level bar reads REAL amplitude from the live stream. If nothing is being captured it
 * sits at zero rather than animating, because a moving bar that means nothing is how a user
 * ends up talking to a microphone that is not listening.
 */
export function VoicePanel({
  state,
  error,
  result,
  level,
  onStop,
  onCancel,
  onAccept,
  onDiscard,
  onRetry,
}: {
  state: RecorderState
  error: VoiceError | null
  result: TranscriptionResult | null
  level: number
  onStop: () => void
  onCancel: () => void
  onAccept: (text: string) => void
  onDiscard: () => void
  onRetry: () => void
}) {
  if (state === 'idle') return null

  if (state === 'requesting') {
    return (
      <Frame tone="slate">
        <Mic className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="flex-1 text-[13px] text-slate-600">Waiting for microphone permission…</span>
      </Frame>
    )
  }

  if (state === 'recording') {
    return (
      <Frame tone="brand">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
        </span>
        <span className="text-[13px] font-medium text-slate-700">Recording…</span>
        {/* Real amplitude, not decoration. */}
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200" aria-hidden>
          <span
            className="block h-full rounded-full bg-brand-500 transition-[width] duration-75"
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </span>
        <button type="button" onClick={onStop} className={actionButton} aria-label="Stop recording">
          <Square className="h-3.5 w-3.5" /> Stop
        </button>
        <button type="button" onClick={onCancel} className={ghostButton} aria-label="Cancel recording">
          <X className="h-4 w-4" />
        </button>
      </Frame>
    )
  }

  if (state === 'transcribing') {
    return (
      <Frame tone="slate">
        <Mic className="h-4 w-4 shrink-0 animate-pulse text-slate-400" />
        <span className="flex-1 text-[13px] text-slate-600">Transcribing…</span>
      </Frame>
    )
  }

  if (state === 'error' && error) {
    return (
      <Frame tone="red">
        <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
        <span className="flex-1 text-[13px] text-red-800">{error.message}</span>
        {error.code !== 'permission_denied' && error.code !== 'no_microphone' && (
          <button type="button" onClick={onRetry} className={actionButton}>
            <RotateCw className="h-3.5 w-3.5" /> Try again
          </button>
        )}
        <button type="button" onClick={onDiscard} className={ghostButton} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </Frame>
    )
  }

  if (state !== 'review' || !result) return null

  // Nothing usable was heard. Offering "use this text" for an empty transcript would be
  // offering the user nothing dressed as something.
  if (result.status === 'unusable') {
    return (
      <Frame tone="amber">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="flex-1 text-[13px] text-amber-900">
          {result.warnings[0]?.message ?? 'No speech was detected in that recording.'}
        </span>
        <button type="button" onClick={onRetry} className={actionButton}>
          <RotateCw className="h-3.5 w-3.5" /> Record again
        </button>
        <button type="button" onClick={onDiscard} className={ghostButton} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </Frame>
    )
  }

  const uncertain = result.status !== 'ok'

  return (
    <div
      className={cn(
        'mb-2.5 rounded-xl border p-3',
        uncertain ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-slate-50/70',
      )}
    >
      <p className="text-[14px] leading-relaxed text-slate-800">{result.text}</p>

      {uncertain && (
        <ul className="mt-2 flex flex-col gap-1">
          {result.warnings.map((warning) => (
            <li key={warning.code} className="flex items-start gap-2 text-[12px] text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {warning.message}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        <button type="button" onClick={() => onAccept(result.text)} className={actionButton}>
          <Check className="h-3.5 w-3.5" />
          {/* The label says what is happening: an uncertain transcript is ACCEPTED by the
              user, not merely inserted. */}
          {uncertain ? 'Use this text anyway' : 'Use this text'}
        </button>
        <button type="button" onClick={onRetry} className={ghostButton}>
          <RotateCw className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onDiscard} className={ghostButton} aria-label="Discard transcript">
          <X className="h-4 w-4" />
        </button>
        <span className="ml-auto text-[11px] text-slate-400">
          {result.detectedLanguage
            ? `${result.detectedLanguage}${result.confidence !== null ? ` · ${Math.round(result.confidence * 100)}%` : ''}`
            : result.model}
        </span>
      </div>
    </div>
  )
}

const actionButton =
  'inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-raised px-2.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50'
const ghostButton =
  'inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/70 hover:text-slate-700'

function Frame({ tone, children }: { tone: 'slate' | 'brand' | 'red' | 'amber'; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'mb-2.5 flex items-center gap-2.5 rounded-xl border px-3 py-2',
        tone === 'red'
          ? 'border-red-200 bg-red-50/60'
          : tone === 'amber'
            ? 'border-amber-200 bg-amber-50/60'
            : tone === 'brand'
              ? 'border-brand-200 bg-brand-50/50'
              : 'border-slate-200 bg-slate-50/70',
      )}
    >
      {children}
    </div>
  )
}
