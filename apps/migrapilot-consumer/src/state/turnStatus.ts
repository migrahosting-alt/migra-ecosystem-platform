/**
 * THE STATUS SEAM: a semantic stage becomes product copy HERE, and nowhere else.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE DEFECT THIS EXISTS FOR
 *
 * Production showed a user this sentence, mid-conversation, during an
 * image-understanding turn:
 *
 *   "Loading the language model — the first answer after a pause takes longer
 *    to start."
 *
 * The Brain authored that prose and the consumer displayed it verbatim. The
 * earlier cold-start work fixed the SHAPE of the indicator — no avatar, no
 * bubble, no timestamp, no controls — and that fix held. What it did not fix
 * was the VOCABULARY: the product was still speaking about language models and
 * pipelines, which is infrastructure describing itself to a person who asked a
 * question about a spreadsheet.
 *
 * It was not the image route. Image UNDERSTANDING runs the text path, which is
 * the one lane that emits `loading_model`. Patching the image route would have
 * left the defect exactly where it was.
 *
 * ---------------------------------------------------------------------------
 * WHY A MAP AND NOT A FILTER
 *
 * A denylist of forbidden words is a keyword proxy: it passes any new sentence
 * nobody thought to ban, and this repository has been bitten by that shape
 * three times. So the Brain's prose is not sanitised — it is never carried.
 * `route.ts` forwards the semantic stage CODE and drops `detail` at the
 * boundary, so infrastructure wording does not reach the browser bundle at all,
 * and the copy below is the only status text that can render.
 *
 * The consequence is deliberate: a stage this map does not know renders as a
 * bare indicator. Silence is the correct output for an unknown condition —
 * inventing a label for it would be the fabricated-progress failure this
 * codebase refuses everywhere else.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS TRADED AWAY, HONESTLY
 *
 * The image queue previously said "Waiting behind 3 job(s)". That number was
 * only ever present inside the prose, so dropping the prose drops the number.
 * The user still learns they are queued. Recovering the count means the Brain
 * emitting `ahead` as a FIELD rather than baking it into a sentence — a
 * contract change recorded as follow-up, not smuggled in here.
 */

/**
 * Semantic stages the Brain emits, mapped to copy this product owns.
 *
 * Written in the product's voice and about the USER'S work, never about the
 * machinery doing it: "Creating your image", not "Loading the image model".
 */
const STATUS_COPY: Readonly<Record<string, string>> = Object.freeze({
  /* Text lane. The only stage the text path emits, and the source of the
   * production defect. "Starting up" is true — something is starting — and
   * says nothing about what a model is. */
  loading_model: 'Starting up',
  /* Image lane, in pipeline order. */
  submitting: 'Sending',
  queued: 'Queued',
  generating: 'Creating your image',
  downloading: 'Almost ready',
})

/**
 * Vocabulary that must never appear in user-facing status copy.
 *
 * Exported so the test asserts it against THIS map rather than restating the
 * rule in its own words — a guard that re-describes the thing it guards will
 * drift away from it.
 *
 * This is a test fixture, NOT a runtime filter. Nothing sanitises copy with it;
 * see the header for why a denylist would be the wrong mechanism.
 */
export const INFRASTRUCTURE_VOCABULARY: readonly string[] = Object.freeze([
  'language model',
  'image model',
  'model',
  'pipeline',
  'checkpoint',
  'server',
  'endpoint',
  'provider',
  'inference',
  'gpu',
  'vram',
  'container',
  'warm',
  'cold',
  'cache',
  'queue depth',
  'job(s)',
])

/**
 * The copy for a stage, or null when there is nothing truthful to say.
 *
 * Null renders a bare indicator — motion without a claim.
 */
export function statusLabelFor(stage: unknown): string | null {
  if (typeof stage !== 'string' || !stage) return null
  return STATUS_COPY[stage] ?? null
}

/** Every label this seam can produce. For tests; not a runtime path. */
export function allStatusLabels(): readonly string[] {
  return Object.values(STATUS_COPY)
}
