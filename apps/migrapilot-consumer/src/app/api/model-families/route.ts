/**
 * The Migra model families this surface may offer.
 *
 * A thin pass-through to the ONE canonical catalog the Brain owns. Deliberately
 * not a place where anything is decided: no local list, no local availability
 * rules, no re-describing a family in this product's own words. If this route
 * ever starts computing something, the consumer and the VS Code extension have
 * begun to drift, which is precisely what the shared catalog exists to prevent.
 *
 * Server-side because the browser must never learn the Brain's address — and
 * because the backend model id travels in this payload for provenance. That id
 * is internal: the UI renders the family, never the model behind it.
 */

import { getModelFamilies } from '@/server/brain/seams'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  /*
   * A signed-out visitor can chat, so a signed-out visitor must be able to see
   * which models exist. The principal still has to be RESOLVED — the gateway
   * refuses a call with no principal at all — but an anonymous one is a perfectly
   * good answer here, because the catalog is the product's capability list and
   * not anybody's data.
   */
  const resolved = await resolveRequestPrincipal()
  if (!resolved) {
    /*
     * No principal at all — not even an anonymous one. Report it rather than
     * returning an empty list: an empty selector is indistinguishable from
     * "every family is unavailable", and the remedy for the two is different.
     */
    return Response.json(
      {
        error: 'model_families_unavailable',
        reason: 'no_principal',
        message: 'The model catalog could not be read for this visitor.',
      },
      { status: 503 },
    )
  }

  const result = await getModelFamilies({ principal: resolved.principal })

  if (result.kind !== 'ok') {
    /*
     * Fail closed and SAY SO. An empty list would render as "this product has no
     * models", which is indistinguishable from every family being unavailable —
     * the same silent-empty failure that taught an agent its workspace had no
     * files. The selector shows an error state instead.
     */
    return Response.json(
      {
        error: 'model_families_unavailable',
        // The gateway's own discrimination is preserved: "sign in" and "the
        // catalog is down" are different problems with different remedies.
        reason: result.kind,
        message: 'The model catalog could not be read. The selector cannot be shown truthfully right now.',
      },
      { status: result.kind === 'unauthenticated' ? 401 : 503 },
    )
  }

  return Response.json(result.value, { status: 200 })
}
