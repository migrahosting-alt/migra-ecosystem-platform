'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Play, Square } from 'lucide-react'

/**
 * Read this answer aloud.
 *
 * 🚨 STOP AND REPLAY CONTROL THE REAL AUDIO, NOT A TIMER.
 *
 * Every state below is read from the `HTMLAudioElement` itself — playing means
 * the element is playing, and stopping calls `pause()` on it. A UI timer
 * imitating playback would drift from the sound the moment anything hiccuped,
 * and would keep "playing" after the audio had actually stopped.
 *
 * 🚨 NOTHING HERE IS PERSISTED, AND THAT IS THE HONEST CHOICE.
 *
 * Audio is synthesised on demand and lives only in this component. So after a
 * reload the control is simply idle — there is no restored "playing" or "ready"
 * state, because there is no audio to be ready. Showing a play-ready control for
 * audio that no longer exists is exactly the false state this avoids.
 *
 * The answer text is canonical and independent: if synthesis fails, the message
 * is untouched and the failure is said plainly, next to the button that caused it.
 */

type State = 'idle' | 'preparing' | 'playing' | 'ready' | 'error'

/*
 * 🚨 A ONE-SAMPLE SILENT WAV, PLAYED INSIDE THE CLICK.
 *
 * Browsers grant audio permission to an element the USER started, and revoke it
 * across an async gap. Synthesis takes seconds, so by the time real audio exists
 * the gesture is long gone and `play()` is refused — which is exactly why this
 * worked under test automation (permissive autoplay policy) and did nothing in a
 * real browser. Starting the element on this silent clip, synchronously, while
 * the click is still live, is what carries the permission across the wait.
 */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

export function SpeakButton({ text, voice }: { text: string; voice?: string }): React.ReactElement | null {
  const [state, setState] = useState<State>('idle')
  const [problem, setProblem] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)

  // Releases the object URL and stops any sound when the turn scrolls away or
  // the conversation changes. Without this, navigating mid-playback leaves audio
  // playing with no visible control to stop it.
  useEffect(() => () => {
    audioRef.current?.pause()
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
  }, [])

  if (!text.trim()) return null

  const stop = () => {
    audioRef.current?.pause()
    if (audioRef.current) audioRef.current.currentTime = 0
    setState('idle')
  }

  const play = async () => {
    setProblem(null)

    // Already synthesised: replay costs nothing and must not re-synthesise.
    if (audioRef.current?.src && audioRef.current.src !== SILENT_WAV) {
      audioRef.current.currentTime = 0
      try {
        await audioRef.current.play()
        setState('playing')
      } catch {
        setState('idle')
      }
      return
    }

    /*
     * BEFORE ANY AWAIT. This is the whole fix: the element is created and
     * started here, while the browser still considers this a user gesture. The
     * clip is silent, so nothing is heard — the point is that the element is now
     * one the user has played, and may be played again later.
     */
    let audio = audioRef.current
    if (!audio) {
      audio = new Audio()
      audio.preload = 'auto'
      audioRef.current = audio
    }
    audio.src = SILENT_WAV
    void audio.play().catch(() => undefined)

    setState('preparing')
    try {
      const res = await fetch('/api/speech/speak', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ text, ...(voice ? { voice } : {}) }),
      })
      const data = (await res.json()) as { audio?: string; message?: string }
      if (!res.ok || !data.audio) {
        // The reason comes from the server, which knows whether the voice
        // service was unreachable or the answer was simply too long.
        setProblem(data.message ?? 'The answer could not be read aloud just now.')
        setState('error')
        return
      }

      const blob = await (await fetch(data.audio)).blob()
      const url = URL.createObjectURL(blob)
      urlRef.current = url
      // The SAME element the user already started — swapping the source keeps
      // the permission a fresh `new Audio()` would not have.
      audio.src = url
      // State follows the element. `ended` is what returns the control to idle,
      // not a setTimeout guessing at the duration.
      audio.addEventListener('ended', () => setState('idle'))
      audio.addEventListener('pause', () => setState((s) => (s === 'playing' ? 'idle' : s)))
      audio.addEventListener('error', () => {
        setProblem('The audio could not be played in this browser.')
        setState('error')
      })
      try {
        await audio.play()
        setState('playing')
      } catch {
        /*
         * Still refused — some browsers are stricter than the unlock above can
         * satisfy. The audio EXISTS and is ready, so the honest move is to say
         * so and let the next click play it: that click is a fresh gesture and
         * always succeeds. Reporting a failure here would be wrong, because
         * nothing failed except the timing of the permission.
         */
        setState('ready')
      }
    } catch {
      setProblem('The answer could not be read aloud just now.')
      setState('error')
    }
  }

  /*
   * 🚨 THIS CONTROL SAYS WHAT IT DOES, IN WORDS.
   *
   * It shipped as a bare speaker icon sitting in a row of secondary actions, and
   * the first person to use it reported that the feature had "no play option" —
   * while it was working correctly. A speaker glyph reads as volume or mute, not
   * as "play this"; and synthesis takes seconds, so an unlabelled spinner looked
   * like nothing had happened at all.
   *
   * So: a play triangle, the word Listen, and — while it works — a visible
   * "Preparing audio…" rather than a silent spin. The wait is real and the user
   * is told about it instead of being left to guess.
   */
  const label =
    state === 'playing' ? 'Stop'
      : state === 'preparing' ? 'Preparing audio…'
        : state === 'ready' ? 'Play'
          : 'Listen'

  return (
    <>
      <button
        type="button"
        aria-label={state === 'playing' ? 'Stop reading' : state === 'preparing' ? 'Preparing audio' : 'Listen to this answer'}
        title={state === 'preparing' ? 'Preparing audio…' : state === 'playing' ? 'Stop' : 'Listen to this answer'}
        disabled={state === 'preparing'}
        onClick={() => (state === 'playing' ? stop() : void play())}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] font-medium text-slate-500 transition-colors hover:bg-raised hover:text-slate-700 disabled:cursor-wait focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400"
      >
        {state === 'preparing' ? (
          // A real pending state, not a progress bar pretending to know how far
          // along a synthesis is. It spins because something IS happening.
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : state === 'playing' ? (
          <Square className="h-3.5 w-3.5 fill-current" strokeWidth={2} />
        ) : (
          <Play className="h-3.5 w-3.5 fill-current" strokeWidth={2} />
        )}
        <span>{label}</span>
      </button>
      {state === 'error' && problem && (
        <span className="text-[12.5px] text-slate-500" role="status">
          {problem}
        </span>
      )}
    </>
  )
}
