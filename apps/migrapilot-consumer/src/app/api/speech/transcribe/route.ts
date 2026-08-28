import { micAvailability } from '@/server/brain/view'
import { transcribe, transcriptionCapability } from '@/server/brain/seams'

/**
 * POST /api/speech/transcribe — one recording, through the Brain.
 *
 * The browser posts audio; the server base64s it and calls the seam. The consumer never
 * talks to an ASR runtime directly, and never to another application.
 *
 * IT RE-CHECKS THE CAPABILITY FIRST. The client gates the microphone on readiness, but a
 * client check is a convenience, not a control: a runtime can go away between enabling the
 * button and the user finishing a sentence. Refusing here means audio is never sent to a
 * capability that is not there.
 */
export const dynamic = 'force-dynamic'

/** ~25 MB, matching the bound the Brain and the runtime both enforce. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

export async function POST(request: Request): Promise<Response> {
  const availability = micAvailability(await transcriptionCapability())
  if (availability.state !== 'ready') {
    return Response.json(
      { error: 'unavailable', message: availability.reason },
      // 503: the contract is fine, the capability behind it is not — a caller should treat
      // that as temporary rather than as a broken request.
      { status: 503 },
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'invalid_body', message: 'Expected a multipart upload.' }, { status: 400 })
  }

  const audio = form.get('audio')
  if (!(audio instanceof Blob) || audio.size === 0) {
    return Response.json({ error: 'no_audio', message: 'No audio was provided.' }, { status: 400 })
  }
  /*
   * A type that is PRESENT and not audio is refused here, with words about what
   * happened. It used to be silently rewritten to 'audio/webm' and transcribed
   * anyway — a video file came back as a successful recording.
   */
  if (audio.type && !audio.type.split(';')[0]!.trim().toLowerCase().startsWith('audio/')) {
    return Response.json(
      { error: 'not_audio', message: 'That file is not an audio recording.' },
      { status: 400 },
    )
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: 'too_large', message: 'That recording is too long.' }, { status: 413 })
  }

  // ONLY when the user explicitly picked a language. An absent field stays absent all the
  // way to the decoder: a default here would be indistinguishable from a choice, which is
  // exactly how the fabrication guard was switched off once already.
  const requested = form.get('requestedLanguage')
  const requestedLanguage = typeof requested === 'string' && requested.trim() ? requested.trim() : undefined

  const result = await transcribe({
    audioBase64: Buffer.from(await audio.arrayBuffer()).toString('base64'),
    /*
     * 🚨 NO SILENT RELABELLING. This used to coerce anything non-audio to
     * 'audio/webm', which meant a video file was accepted and transcribed as
     * though someone had recorded it — proven live: video/mp4 returned 200. A
     * default that rewrites the caller's claim is not a default, it is a lie
     * with a fallback value.
     *
     * An absent type still defaults, because a Blob legitimately arrives without
     * one; a type that is present and wrong is refused above.
     */
    audioMime: audio.type ? audio.type : 'audio/webm',
    ...(requestedLanguage ? { requestedLanguage } : {}),
  })

  if (result.kind !== 'ok') {
    return Response.json(
      { error: result.kind, message: 'That recording could not be transcribed.' },
      { status: result.kind === 'unauthenticated' ? 401 : 503 },
    )
  }

  // The full TranscriptionResult, verdict included. The client decides what to SHOW, never
  // whether the transcript is safe — that was decided once, in the Brain.
  return Response.json(result.value)
}
