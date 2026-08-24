import 'server-only'

import { isImageId } from '@/server/files/images'

/**
 * Turn attachments — an ORDERED COLLECTION of opaque references.
 *
 * SHAPED FOR MORE THAN ONE IMAGE FROM THE START, even though the first
 * implementation accepts exactly one. "One image" baked into the transport
 * becomes a breaking change the moment someone attaches two photos to compare
 * them, or a screenshot plus the document it came from — and a transport change
 * is the expensive kind, because it lands in the consumer, the contract, the
 * Brain and every persisted turn at once. A list that currently holds one entry
 * costs nothing today and removes that migration entirely.
 *
 * ORDER IS MEANINGFUL and preserved. "Compare the first with the second" is only
 * answerable if the sequence the user chose survives the transport, so this is a
 * list rather than a set, and nothing sorts or de-duplicates it in flight.
 *
 * KIND AND PURPOSE ARE CARRIED SEPARATELY. `kind` is what the bytes are —
 * extensible to audio or a document later. `purpose` is why they are attached,
 * which is a different question: the same image can be the SUBJECT of a
 * question or the REFERENCE a result is judged against, and a generation step
 * later needs to tell those apart. Both are declared now so neither becomes a
 * second breaking change.
 *
 * THE REF IS OPAQUE AND IS NEVER A PATH. It names a record the Brain resolves
 * through its own storage state; the browser cannot say where bytes live.
 */

export type AttachmentKind = 'image'
export type AttachmentPurpose = 'subject' | 'reference'

export interface TurnAttachment {
  /** Opaque, content-addressed. Currently `img_<32 hex>`. */
  ref: string
  kind: AttachmentKind
  /**
   * Defaults to `subject` — the thing being asked about. `reference` exists for
   * the compare-and-correct workflows that come with generation.
   */
  purpose: AttachmentPurpose
}

/**
 * How many attachments one turn may carry.
 *
 * Bounded because each one becomes image tokens in a vision context window, and
 * an unbounded list is an unbounded bill and an unbounded latency. Raising it is
 * a config decision backed by measurement, not an oversight to discover in
 * production.
 */
export const MAX_TURN_ATTACHMENTS = 4

export type AttachmentRejection =
  | { code: 'too_many'; message: string }
  | { code: 'invalid_ref'; message: string }
  | { code: 'unsupported_kind'; message: string }
  | { code: 'duplicate_ref'; message: string }

/**
 * Validate what a caller says it is attaching.
 *
 * Shape only — this decides nothing about whether the referenced image EXISTS or
 * whether the caller may read it. Both of those are the resolver's job on the
 * Brain side, deliberately: a consumer-side existence check would be a second
 * authority that can disagree with the first, and the one that disagrees is the
 * one that lets something through.
 */
export function validateAttachments(
  raw: unknown,
): { ok: true; attachments: TurnAttachment[] } | { ok: false; rejection: AttachmentRejection } {
  if (raw === undefined || raw === null) return { ok: true, attachments: [] }
  if (!Array.isArray(raw)) {
    return { ok: false, rejection: { code: 'invalid_ref', message: 'Attachments must be a list.' } }
  }
  if (raw.length > MAX_TURN_ATTACHMENTS) {
    return {
      ok: false,
      rejection: {
        code: 'too_many',
        message: `A message can carry up to ${MAX_TURN_ATTACHMENTS} attachments.`,
      },
    }
  }

  const attachments: TurnAttachment[] = []
  const seen = new Set<string>()

  for (const entry of raw) {
    const item = entry as Partial<TurnAttachment> | null
    const kind = item?.kind ?? 'image'
    if (kind !== 'image') {
      return {
        ok: false,
        rejection: { code: 'unsupported_kind', message: `Attachments of kind "${String(kind)}" are not supported yet.` },
      }
    }

    const ref = item?.ref
    /*
     * The ref is validated against the ID SHAPE, not merely "is a string". A
     * resolver that receives something path-like has already been handed the
     * wrong kind of thing, and the earliest place to refuse it is here.
     */
    if (!isImageId(ref)) {
      return { ok: false, rejection: { code: 'invalid_ref', message: 'That attachment reference is not valid.' } }
    }

    /*
     * The same image twice in one turn is refused rather than silently collapsed.
     * Collapsing changes the ORDER the user chose, and "compare the first with
     * the second" then answers about a list they did not send.
     */
    if (seen.has(ref)) {
      return { ok: false, rejection: { code: 'duplicate_ref', message: 'That image is already attached to this message.' } }
    }
    seen.add(ref)

    const purpose: AttachmentPurpose = item?.purpose === 'reference' ? 'reference' : 'subject'
    attachments.push({ ref, kind: 'image', purpose })
  }

  return { ok: true, attachments }
}

/** True when a turn carries anything that needs a vision-capable model. */
export const needsVision = (attachments: readonly TurnAttachment[]): boolean =>
  attachments.some((a) => a.kind === 'image')
