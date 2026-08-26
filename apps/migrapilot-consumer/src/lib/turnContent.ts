/**
 * What makes an assistant turn real.
 *
 * THE INVARIANT, IN ONE PLACE:
 *
 *   a valid turn = text content OR durable artifact refs
 *
 * WHY IT LIVES HERE. This rule was re-encoded independently in five places and
 * got it wrong in all five, because each place asked "is there text?" and an
 * image-generation turn has none. In order, the same defect appeared as:
 *
 *   1. `producedOutput` on the stream route — refunded the turn, discarded the
 *      image, and told the user nothing was produced
 *   2. `done && streamed.trim()` in the client — `discardPartial()` deleted the
 *      message that held the picture
 *   3. `toMessage` — the assistant branch dropped `imageRefs`, so it vanished on
 *      reload
 *   4. the messages read route — filtered the whole message away as "still
 *      being written"
 *   5. `fetchMessages` — export produced a transcript with the picture missing
 *
 * Each fix addressed only the spot that had visibly bitten, which is exactly why
 * the feature kept looking finished and kept failing one step later. A rule
 * spread across five files is five chances to encode its opposite; a rule with
 * one home is one.
 *
 * NOT EVERY EMPTY TURN IS VALID. A turn with neither text nor artifacts is still
 * nothing — that distinction is the whole point, and it is what lets a
 * half-written turn be withheld while a finished picture is delivered.
 */

/** The canonical shape of an artifact ref. Anything else is not one. */
const ARTIFACT_REF = /^img_[0-9a-f]{32}$/

export interface TurnLikeMessage {
  content?: string | null
  imageRefs?: readonly unknown[] | null
}

/** The refs on a turn that are actually usable, filtered to the canonical shape. */
export function artifactRefs(message: TurnLikeMessage): string[] {
  if (!Array.isArray(message.imageRefs)) return []
  return message.imageRefs.filter((ref): ref is string => typeof ref === 'string' && ARTIFACT_REF.test(ref))
}

/** Does this turn carry text a reader would see? */
export function hasText(message: TurnLikeMessage): boolean {
  return typeof message.content === 'string' && message.content.trim().length > 0
}

/**
 * Does this turn contain anything at all?
 *
 * The single question every filter, completion check and serializer should ask
 * instead of measuring `content.length` for itself.
 */
export function hasDeliverableContent(message: TurnLikeMessage): boolean {
  return hasText(message) || artifactRefs(message).length > 0
}
