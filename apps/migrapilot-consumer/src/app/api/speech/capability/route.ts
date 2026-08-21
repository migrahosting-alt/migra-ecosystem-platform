import { micAvailability } from '@/server/brain/view'
import { transcriptionCapability } from '@/server/brain/seams'

/**
 * GET /api/speech/capability — may this browser offer a microphone?
 *
 * The consumer asks the BRAIN, never another application. apps/pilot-web owns a whisper
 * runtime, but importing across apps would couple the product to the Command Center's
 * implementation and rebuild the island this boundary exists to remove. When the Brain does
 * not implement the operation yet, that surfaces as `incompatible` — distinguishable from
 * "switched off", so a missing capability never looks like a setting someone can flip.
 *
 * Returns the reduced MicAvailability rather than the raw capability: the safety decision is
 * made once, on the server, and the composer only reads a verdict.
 */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return Response.json(micAvailability(await transcriptionCapability()))
}
