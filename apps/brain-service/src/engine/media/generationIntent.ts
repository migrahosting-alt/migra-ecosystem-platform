/**
 * Is this turn asking for an image to be MADE, rather than described?
 *
 * WHY THIS EXISTS. "generate letter A in png" returned a tutorial listing
 * Photoshop, Canva and Pillow — a correct answer to a question nobody asked. The
 * routing record showed why: `alternatives: []`. The capability router had not
 * rejected an image generator, it had never had one to consider, so the turn
 * went to a text model and a text model did what text models do.
 *
 * A LEXICAL HEURISTIC, NOT COMPREHENSION — the same honest limit as
 * `visualOperation.ts`. It matches how people actually ask for a picture. It
 * cannot know that "how do I generate a PNG in Python?" wants code while
 * "generate a png of a cat" wants a cat, so both of those are handled
 * explicitly; a phrasing outside what is listed here falls through to text, and
 * that is the residual risk, stated rather than papered over.
 *
 * FALSE POSITIVES ARE THE EXPENSIVE DIRECTION HERE, which is the opposite of the
 * counting classifier. Misreading "explain how diffusion models work" as a
 * request for a picture spends 30 seconds of GPU and returns an image instead of
 * an answer. So the verbs are required to co-occur with an image noun, and the
 * how-to phrasings that ask for INSTRUCTIONS are excluded first.
 */

/** Asking how to do it themselves — instructions, not an artefact. */
const INSTRUCTIONAL: readonly RegExp[] = [
  /\bhow (do|can|would|should) (i|we|you)\b/i,
  /\bhow to\b/i,
  /\b(write|show me|give me) (some |the )?(code|a script|a function|an example)\b/i,
  /\bwhat('s| is) the best way\b/i,
  /\b(explain|describe|tell me about)\b/i,
  /\busing (python|pillow|pil|imagemagick|canvas|svg|css|photoshop|figma|illustrator)\b/i,
  /\bin (python|javascript|typescript|java|c\+\+|rust|go)\b/i,
]

/** The act of producing a picture. */
const MAKE: readonly RegExp[] = [
  /\b(generate|create|make|draw|paint|render|produce|design|illustrate)\b/i,
  /\bimagine\b/i,
  /\ba picture of\b/i,
  /\ban image of\b/i,
]

/** The thing produced. Anchored so "imagery" and "imagine" do not count as nouns. */
const ARTEFACT: readonly RegExp[] = [
  /\bimages?\b/i,
  /\bpictures?\b/i,
  /\bphotos?\b/i,
  /\bdrawings?\b/i,
  /\bpaintings?\b/i,
  /\billustrations?\b/i,
  /\blogos?\b/i,
  /\bicons?\b/i,
  /\bposters?\b/i,
  /\bwallpapers?\b/i,
  /\bartwork\b/i,
  /\bpngs?\b/i,
  /\bjpe?gs?\b/i,
]

/** Unambiguous on its own — no artefact noun needed. */
const EXPLICIT: readonly RegExp[] = [
  /\b(draw|paint|illustrate|sketch)\s+(me\s+)?(a|an|the)\b/i,
  /\ba picture of\b/i,
  /\ban image of\b/i,
]

export type TurnIntent = 'image_generation' | 'text'

/**
 * What the user wants done, when an image is already in the turn.
 *
 * WHY THIS EXISTS. The generation route was gated on `!hasImage`, so ANY picture
 * in the turn disabled creation outright. "generate letter C in png" sent after
 * an upload was answered as a question about the upload — the model described
 * the attached gradient and offered to explain how to make a letter. The user's
 * verb was ignored because a previous attachment was still in scope.
 *
 * THE RULE: an explicit request to CREATE outranks residual image context. An
 * attached image is evidence, not an automatic override of the current verb. It
 * only wins when the prompt actually points at it — "edit this image", "what is
 * in this picture", "make this one blue".
 *
 * Lexical, like everything else here, with the same stated limit: a phrasing
 * outside these lists falls through to treating the attached image as the
 * subject, which is the safe direction when a picture is genuinely present.
 */
export type ImageTurnIntent = 'create' | 'transform' | 'understand' | 'text'

/** Points at an image already in the conversation. */
const REFERENTIAL: readonly RegExp[] = [
  /\b(this|that|the) (image|picture|photo|screenshot|png|jpe?g|one)\b/i,
  /\bthe (image|picture|photo|screenshot) (above|attached|below)\b/i,
  /\b(i|you) (just )?(sent|uploaded|shared|attached)\b/i,
  /\battached\b/i,
  /\bmake it\b/i,
  /\bchange it\b/i,
  /\bin (it|here)\b/i,
]

/** Alters an image that already exists. */
const TRANSFORM: readonly RegExp[] = [
  /\b(edit|modify|change|adjust|retouch|fix|clean up)\b/i,
  /\b(crop|resize|scale|rotate|flip|mirror|upscale)\b/i,
  /\b(recolou?r|colou?rise|blur|sharpen|brighten|darken|enhance)\b/i,
  /\b(remove|erase|delete|cut out|take out)\b/i,
  /\b(add|put|place|insert)\b/i,
  /\breplace\b/i,
  /\bmake (it|this|that|them)\b/i,
]

/** Asks about an image that already exists. */
const UNDERSTAND: readonly RegExp[] = [
  /\b(describe|analy[sz]e|identify|recogni[sz]e|transcribe|ocr|summari[sz]e)\b/i,
  /\bwhat('s| is| are| do you see)\b/i,
  /\bhow many\b/i,
  /\b(who|where|when|which)\b/i,
  /\b(read|count|list)\b/i,
  /\btell me\b/i,
]

const matches = (patterns: readonly RegExp[], text: string): boolean =>
  patterns.some((re) => re.test(text))

export function classifyImageTurn(prompt: string, hasImage: boolean): ImageTurnIntent {
  const text = prompt.trim()
  const wantsCreation = classifyGenerationIntent(text) === 'image_generation'

  // Nothing attached: the only question is whether they asked for a picture.
  if (!hasImage) return wantsCreation ? 'create' : 'text'

  const refersToIt = matches(REFERENTIAL, text)

  // THE INVARIANT. A clear request to make something new wins over an image that
  // merely happens to be in scope — unless the prompt points at that image.
  if (wantsCreation && !refersToIt) return 'create'

  if (refersToIt && matches(TRANSFORM, text)) return 'transform'
  if (matches(UNDERSTAND, text)) return 'understand'
  if (refersToIt) return 'understand'

  // A picture is present and the prompt named no other subject: it is about the
  // picture. Guessing "create" here would spend GPU answering the wrong question.
  return 'understand'
}

export function classifyGenerationIntent(prompt: string): TurnIntent {
  const text = prompt.trim()
  if (!text) return 'text'

  // Instructions win. Someone asking how to make an image themselves wants the
  // explanation, and handing them a picture instead answers a different question.
  if (INSTRUCTIONAL.some((re) => re.test(text))) return 'text'

  if (EXPLICIT.some((re) => re.test(text))) return 'image_generation'

  const asksToMake = MAKE.some((re) => re.test(text))
  const namesArtefact = ARTEFACT.some((re) => re.test(text))
  // BOTH are required. "generate a summary" is not a picture, and "the png is
  // broken" is not a request to make one.
  return asksToMake && namesArtefact ? 'image_generation' : 'text'
}
