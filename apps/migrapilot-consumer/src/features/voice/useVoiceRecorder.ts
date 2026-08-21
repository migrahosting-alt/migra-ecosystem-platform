'use client'

import { useCallback, useRef, useState } from 'react'
import type { TranscriptionResult } from '@migrapilot/shared-types/transcription'

/**
 * Microphone capture, for real.
 *
 * NO FAKE LISTENING STATE. Every state below is driven by an actual MediaRecorder event, not
 * by a timer or an optimistic setState. `recording` begins when the recorder starts, and the
 * level meter reads real samples from an AnalyserNode. An animation that implies capture
 * while nothing is being captured is the same class of lie as a progress bar with no process
 * behind it.
 *
 * The safety verdict is NOT made here. The Brain returns a TranscriptionResult with its own
 * `status`, and this hook surfaces it unchanged; nothing in the browser may promote a
 * transcript to safe.
 */

export type RecorderState =
  | 'idle'
  /** Browser permission prompt is open. */
  | 'requesting'
  | 'recording'
  /** Audio captured, being transcribed. */
  | 'transcribing'
  /** A transcript is back and awaiting the user. */
  | 'review'
  | 'error'

export interface VoiceError {
  code: 'permission_denied' | 'no_microphone' | 'unsupported' | 'transcribe_failed' | 'empty'
  message: string
}

const errorFor = (error: unknown): VoiceError => {
  const name = (error as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      code: 'permission_denied',
      message: 'Microphone access was blocked. Allow it in your browser to dictate.',
    }
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return { code: 'no_microphone', message: 'No microphone was found on this device.' }
  }
  return { code: 'unsupported', message: 'This browser could not start a recording.' }
}

export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>('idle')
  const [error, setError] = useState<VoiceError | null>(null)
  const [result, setResult] = useState<TranscriptionResult | null>(null)
  const [level, setLevel] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const frameRef = useRef<number | null>(null)
  /** Set by cancel() so the stop handler knows to discard rather than transcribe. */
  const cancelledRef = useRef(false)

  const teardown = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    // Releasing the tracks is what turns the browser's recording indicator off. Leaving
    // them open would keep the tab looking like it is listening when it is not.
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    void audioContextRef.current?.close().catch(() => {})
    audioContextRef.current = null
    recorderRef.current = null
    setLevel(0)
  }, [])

  /** Real amplitude from the live stream — the meter must never be decorative. */
  const meter = useCallback((stream: MediaStream) => {
    try {
      const context = new AudioContext()
      audioContextRef.current = context
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      context.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (const sample of data) peak = Math.max(peak, Math.abs(sample - 128))
        setLevel(Math.min(1, peak / 96))
        frameRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      // A missing AnalyserNode must not stop the recording; the meter simply stays at 0
      // rather than being faked.
    }
  }, [])

  const transcribeBlob = useCallback(async (blob: Blob) => {
    if (blob.size === 0) {
      setState('error')
      setError({ code: 'empty', message: 'Nothing was recorded.' })
      return
    }
    setState('transcribing')
    try {
      const body = new FormData()
      body.append('audio', blob, 'recording.webm')
      const response = await fetch('/api/speech/transcribe', { method: 'POST', body })
      const payload = await response.json()
      if (!response.ok) {
        setState('error')
        setError({ code: 'transcribe_failed', message: payload?.message ?? 'That recording could not be transcribed.' })
        return
      }
      setResult(payload as TranscriptionResult)
      setState('review')
    } catch {
      setState('error')
      setError({ code: 'transcribe_failed', message: 'The transcription service could not be reached.' })
    }
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setResult(null)
    cancelledRef.current = false

    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState('error')
      setError({ code: 'unsupported', message: 'This browser does not support voice recording.' })
      return
    }

    setState('requesting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (denied) {
      setState('error')
      setError(errorFor(denied))
      return
    }

    streamRef.current = stream
    chunksRef.current = []
    const recorder = new MediaRecorder(stream)
    recorderRef.current = recorder

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      const chunks = chunksRef.current
      const cancelled = cancelledRef.current
      teardown()
      if (cancelled) {
        setState('idle')
        return
      }
      void transcribeBlob(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
    }
    // `recording` is set by the recorder's own start event, so the UI cannot show capture
    // that has not begun.
    recorder.onstart = () => setState('recording')
    recorder.onerror = () => {
      teardown()
      setState('error')
      setError({ code: 'unsupported', message: 'The recording stopped unexpectedly.' })
    }

    recorder.start()
    meter(stream)
  }, [meter, teardown, transcribeBlob])

  const stop = useCallback(() => {
    cancelledRef.current = false
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  /** Discard: the audio is never sent anywhere. */
  const cancel = useCallback(() => {
    cancelledRef.current = true
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    } else {
      teardown()
      setState('idle')
    }
    setResult(null)
    setError(null)
  }, [teardown])

  /** Dismiss a transcript without using it. */
  const discard = useCallback(() => {
    setResult(null)
    setError(null)
    setState('idle')
  }, [])

  return { state, error, result, level, start, stop, cancel, discard }
}
