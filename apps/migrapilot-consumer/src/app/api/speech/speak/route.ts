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

/**
 * 🚨 A REFUSAL IS NOT AN OUTAGE, and this route used to report it as one.
 *
 * `synthesisCapability` and `synthesizeSpeech` are absent from the operation
 * audience table, so a signed-out visitor is refused with
 * `forbidden_for_principal` — and every failure here collapsed into "the voice
 * service could not be reached". The Listen control therefore rendered live for
 * every visitor, failed on click, and blamed our infrastructure for a decision
 * about accounts. That is the same defect this product already fixed twice, for
 * rename/delete and for the thumbs.
 *
 * The reason is separated here so the control can be honestly disabled with the
 * true sentence instead of enabled with a false one.
 */
const REQUIRES_ACCOUNT = 'Sign in to have answers read aloud.'

export async function GET(): Promise<Response> {
  const result = await synthesisCapability()
  if (result.kind === 'forbidden_for_principal') {
    return Response.json({ ready: false, voices: [], reason: REQUIRES_ACCOUNT, requiresAccount: true })
  }
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
  if (result.kind === 'forbidden_for_principal') {
    /*
     * 403, not 503. The service is fine; this caller may not use it. Returning
     * an outage code here is what made "sign in for this" look like a fault the
     * user should retry — and retrying can never succeed.
     */
    return Response.json(
      { error: 'requires_account', message: `${REQUIRES_ACCOUNT} The text above is unaffected.` },
      { status: 403 },
    )
  }
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
