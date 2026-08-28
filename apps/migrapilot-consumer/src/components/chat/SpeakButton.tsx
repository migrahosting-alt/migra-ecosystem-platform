'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Volume2, VolumeX } from 'lucide-react'

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

type State = 'idle' | 'preparing' | 'playing' | 'error'

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
    if (audioRef.current) {
      audioRef.current.currentTime = 0
      try {
        await audioRef.current.play()
        setState('playing')
      } catch {
        setState('idle')
      }
      return
    }

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
      const audio = new Audio(url)
      audioRef.current = audio
      // State follows the element. `ended` is what returns the control to idle,
      // not a setTimeout guessing at the duration.
      audio.addEventListener('ended', () => setState('idle'))
      audio.addEventListener('pause', () => setState((s) => (s === 'playing' ? 'idle' : s)))
      audio.addEventListener('error', () => {
        setProblem('The audio could not be played in this browser.')
        setState('error')
      })
      await audio.play()
      setState('playing')
    } catch {
      setProblem('The answer could not be read aloud just now.')
      setState('error')
    }
  }

  const label =
    state === 'playing' ? 'Stop reading' : state === 'preparing' ? 'Preparing audio' : 'Read aloud'

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={state === 'preparing'}
        onClick={() => (state === 'playing' ? stop() : void play())}
        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-raised hover:text-slate-600 disabled:cursor-wait disabled:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400"
      >
        {state === 'preparing' ? (
          // A real pending state, not a progress bar pretending to know how far
          // along a synthesis is. It spins because something IS happening.
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
        ) : state === 'playing' ? (
          <VolumeX className="h-4 w-4" strokeWidth={1.8} />
        ) : (
          <Volume2 className="h-4 w-4" strokeWidth={1.8} />
        )}
      </button>
      {state === 'error' && problem && (
        <span className="text-[12.5px] text-slate-500" role="status">
          {problem}
        </span>
      )}
    </>
  )
}
