import { synthesisCapability, synthesizeSpeech } from '@/server/brain/seams'

/**
 * POST /api/speech/speak — read an answer aloud.
 *
 * 🚨 THE TEXT IS CANONICAL AND THIS ROUTE CANNOT HARM IT.
 *
 * The answer already exists, already streamed, and is already stored. Speaking
 * it is a separate, later, optional act — so every failure here returns a reason
 * and changes nothing about the message. There is no path from a synthesis fault
 * to a lost or altered answer, by construction: this route never writes.
 *
 * GET returns the voices a user may choose. Engine names never appear in either
 * direction; the Brain strips them, and nothing here puts them back.
 */
export const dynamic = 'force-dynamic'

/** Matches the Brain's ceiling so an over-long answer fails here, cheaply. */
const MAX_CHARS = 4000

export async function GET(): Promise<Response> {
  const result = await synthesisCapability()
  if (result.kind !== 'ok') {
    // Not an error state for the caller: "we cannot speak right now" is a valid
    // answer to "can you speak", and the composer must render it as a disabled
    // control with a reason rather than a broken one.
    return Response.json({ ready: false, voices: [], reason: 'The voice service could not be reached.' })
  }
  const value = result.value
  return Response.json({
    ready: value?.ready === true,
    voices: value?.voices ?? [],
    ...(value?.defaultVoice ? { defaultVoice: value.defaultVoice } : {}),
    ...(value?.unavailableReason ? { reason: value.unavailableReason } : {}),
  })
}

export async function POST(request: Request): Promise<Response> {
  let body: { text?: unknown; voice?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_request', message: 'Malformed request.' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return Response.json({ error: 'invalid_request', message: 'There is nothing to read aloud.' }, { status: 400 })
  }
  if (text.length > MAX_CHARS) {
    return Response.json(
      { error: 'too_long', message: 'That answer is too long to read aloud in one go.' },
      { status: 413 },
    )
  }
  const voice = typeof body.voice === 'string' ? body.voice : undefined

  const result = await synthesizeSpeech(text, voice)
  if (result.kind !== 'ok' || !result.value?.audioBase64) {
    /*
     * Specific, and about the voice alone. The answer is on screen and stays
     * there — a message that made speech sound like a lost reply would be a lie
     * about what happened.
     */
    return Response.json(
      {
        error: 'speech_unavailable',
        message: 'The answer could not be read aloud just now. The text above is unaffected.',
      },
      { status: 503 },
    )
  }

  const speech = result.value
  return Response.json({
    audio: `data:${speech.mimeType};base64,${speech.audioBase64}`,
    durationSec: speech.durationSec,
    voice: speech.voice,
  })
}
