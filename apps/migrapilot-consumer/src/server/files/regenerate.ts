/**
 * What "regenerate it" can honestly do to the image already in the conversation.
 *
 * The rule this enforces: never promise regeneration unless an executable
 * capability exists, and never describe the picture again when someone asked for
 * a new one. Those were the two halves of the shipped defect — the turn was
 * classified as a question, so the model answered by describing the image, which
 * is neither doing the work nor refusing it.
 *
 * The split is decided by PROVENANCE, not by guesswork:
 *
 *  - an image WE generated carries the prompt that produced it, so running that
 *    prompt again is a real regeneration and is executed;
 *  - an image the user UPLOADED has no prompt, and reproducing it would mean
 *    image-to-image, which this system cannot do — so it is refused, plainly,
 *    with the one thing that would work offered instead.
 */

import { listImages } from '@/server/files/imageStore'

export type RegeneratePlan =
  /** Re-run the pipeline with the prompt that produced this image. */
  | { kind: 'execute'; ref: string; prompt: string; model?: string }
  /** Cannot be done. `message` is what the user is told, and it is the truth. */
  | { kind: 'refuse'; reason: 'uploaded_image' | 'no_recorded_prompt' | 'no_active_image'; message: string }

const NO_ACTIVE_IMAGE =
  'There is no image in this conversation to regenerate. Attach one, or describe the picture you want.'

/*
 * An uploaded photo cannot be regenerated, and saying so is the whole point.
 *
 * The alternative offered is real: describing a NEW image is supported, and
 * pointing at it costs the user nothing. What must never appear here is a
 * promise to reproduce the upload.
 */
const UPLOADED_IMAGE =
  'I can\'t regenerate a picture you uploaded — I don\'t have the prompt that made it, '
  + 'and I can\'t recreate an existing image from the image itself yet. '
  + 'Tell me what you\'d like pictured and I\'ll generate a new one.'

const NO_RECORDED_PROMPT =
  'I can\'t regenerate that image — I don\'t have a record of the prompt that produced it. '
  + 'Describe what you\'d like and I\'ll generate a new one.'

/**
 * Decide what a regenerate turn should do, from the active image alone.
 *
 * Takes the ref rather than the whole conversation so the decision is testable
 * without a chat turn — this is the logic that must not be got wrong quietly.
 */
export async function planRegeneration(activeImageRef: string | undefined): Promise<RegeneratePlan> {
  if (!activeImageRef) {
    return { kind: 'refuse', reason: 'no_active_image', message: NO_ACTIVE_IMAGE }
  }

  /*
   * Read from the caller's own library listing rather than by path. An id that
   * this scope cannot see must behave exactly like an id that does not exist —
   * otherwise the refusal text itself would confirm another tenant's artifact.
   */
  const owned = await listImages().catch(() => [])
  const meta = owned.find((image) => image.id === activeImageRef)
  const provenance = meta?.provenance

  if (!provenance || provenance.origin !== 'generated') {
    return { kind: 'refuse', reason: 'uploaded_image', message: UPLOADED_IMAGE }
  }

  const prompt = provenance.prompt?.trim()
  if (!prompt) {
    /*
     * Generated, but from before prompts were recorded. Distinguished from an
     * upload because the remedy is the same but the reason is not, and telling
     * someone their generated image was "uploaded" is a small lie that makes the
     * rest of the sentence untrustworthy.
     */
    return { kind: 'refuse', reason: 'no_recorded_prompt', message: NO_RECORDED_PROMPT }
  }

  return {
    kind: 'execute',
    ref: activeImageRef,
    prompt,
    ...(provenance.model ? { model: provenance.model } : {}),
  }
}

/**
 * Does this turn ask for the same picture again?
 *
 * Mirrors the Brain's REGENERATE patterns. The consumer needs the answer before
 * it decides whether to read the library at all, and it must agree with the
 * engine — a turn the Brain routes as regenerate while the consumer treats it as
 * an ordinary question is the split that produced the original defect.
 */
export function wantsRegeneration(prompt: string): boolean {
  const text = prompt.trim()
  if (!text) return false
  return [
    /\b(re-?generate|re-?make|re-?create|re-?draw|re-?do|re-?run)\b/i,
    /\b(make|generate|create|draw|do)\s+(it|this|that|one)\s+again\b/i,
    /\b(again|another)\s+(one|version|time)\b/i,
    /\bsame\s+(one|image|picture|thing)\b/i,
    /\b(one|something)\s+(like|similar to)\s+(it|this|that)\b/i,
    /\bsomething\s+similar\b/i,
    /\btry\s+(it\s+)?again\b/i,
  ].some((re) => re.test(text))
}
