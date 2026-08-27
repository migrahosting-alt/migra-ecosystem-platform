/**
 * The user's sentence is not a diffusion prompt.
 *
 * WHY THIS EXISTS. "generate letter A in png" contains three things a diffusion
 * model should never see: an imperative aimed at an assistant, a file format,
 * and no description of an image. Passed through verbatim it produced four
 * overlapping letterforms reading "ACAA" — a real PNG, and the wrong picture.
 *
 * MEASURED, NOT REASONED. Three phrasings were generated at fixed seed against
 * the real pipeline and looked at:
 *
 *   "letter A"                                     -> a wall of letterforms
 *   "the single capital letter A, centered, ..."   -> an A textured with garbled text
 *   "a single capital letter 'A', bold black serif
 *    typography, ..., one letter only"             -> a clean single A
 *
 * SHAPING IS DELIBERATELY NARROW. Only the request grammar is removed, and only
 * one class of subject — a single character — is expanded, because that is the
 * class the model demonstrably gets wrong without help. Everything else is
 * passed through as the user wrote it: rewriting someone's description of the
 * picture they want is how you return a confident, well-composed image of
 * something they did not ask for.
 */

/** Imperatives aimed at the assistant, not at the canvas. */
const REQUEST_PREFIX =
  /^\s*(please\s+)?(can you\s+|could you\s+|i want you to\s+|i(?:'d| would) like\s+)?(generate|create|make|draw|paint|render|produce|design|illustrate|show|give|send|get)\s+(me\s+)?((an?|the)\s+(image|picture|drawing|illustration|photo|png|jpe?g|webp|gif|svg|file)\s+of\s+)?/i

/*
 * The article is consumed ONLY as part of "an image of". An earlier version
 * stripped a leading `a|an|the` unconditionally and ate the subject of
 * "generate A in png" — the letter A read as the article "a" — leaving "in png",
 * which then stripped to nothing. It also has to leave "a cat wearing a red hat"
 * with its article, since that is the user's own phrasing of the picture.
 */

/** File formats and delivery words: instructions about the artefact, not its content. */
const FORMAT_SUFFIX =
  /\s*(,?\s*(in|as|to)\s+(a\s+)?)?(png|jpe?g|webp|gif|svg|image|picture|file|format)\s*(file|format|image)?\s*$/i

/** A request for one character to be drawn. */
/*
 * The NOUN is optional when a case modifier is present.
 *
 * "make me a capital B" names no noun and was read as a scene, so a request that
 * could only ever mean one glyph went to diffusion. "capital"/"lowercase" already
 * says the subject is a character — nothing else in English is capitalised — so
 * requiring the word "letter" as well only rejected the shorter phrasing people
 * actually use. The single-character anchor at the end still does the real work:
 * "a capital city" cannot match it.
 */
const SINGLE_CHARACTER =
  /^(the\s+|a\s+)?(?:(capital|uppercase|upper[- ]case|lowercase|lower[- ]case|small)\s*(letter|character|digit|number|symbol)?|(?:capital|uppercase|lowercase|small)?\s*(letter|character|digit|number|symbol))\s+["'“”]?([A-Za-z0-9])["'“”]?$/i

/** A bare character, once the request grammar is gone: "generate A in png" -> "A". */
const BARE_CHARACTER = /^["'“”]?([A-Za-z0-9])["'“”]?$/

/** Remove the imperative aimed at an assistant and the file-format instruction. */
function stripRequestGrammar(userPrompt: string): string {
  let text = userPrompt.trim()
  // Order matters: the suffix rule would otherwise eat the word "image" out of
  // "image of a cat".
  text = text.replace(REQUEST_PREFIX, '')
  let previous: string
  do {
    previous = text
    text = text.replace(FORMAT_SUFFIX, '').trim()
  } while (text !== previous && text.length > 0)
  return text.replace(/[.!?]+$/, '').trim()
}

export function shapeImagePrompt(userPrompt: string): string {
  const text = stripRequestGrammar(userPrompt)

  if (!text) return userPrompt.trim()

  const single = SINGLE_CHARACTER.exec(text)
  const bare = BARE_CHARACTER.exec(text)
  const character = single?.[5] ?? bare?.[1]
  if (character) {
    const lower = /lower/i.test(single?.[2] ?? '') || /small/i.test(single?.[2] ?? '')
    const glyph = lower ? character.toLowerCase() : character.toUpperCase()
    const named = lower ? 'lowercase letter' : /[0-9]/.test(glyph) ? 'digit' : 'capital letter'
    /*
     * "one letter only" is load-bearing: without it the model tiles the glyph
     * across the canvas, which is exactly the ACAA failure. "typography" pulls it
     * toward a typeface rather than a painting of a shape.
     */
    return `a single ${named} '${glyph}', bold black serif typography, centered on a plain white background, one letter only`
  }

  return text
}


/**
 * What KIND of picture was asked for.
 *
 * A single character is not an artistic request, and diffusion cannot be made to
 * spell: the same shaped prompt produced a clean capital A at one seed and four
 * glyphs reading "a a I I" at another. A font already contains the exact outline,
 * so a bare glyph is DRAWN rather than sampled — correct every time instead of
 * most times, and in milliseconds instead of seconds of GPU.
 *
 * Deliberately narrow. Only a request that resolves to one character takes the
 * deterministic path; everything else is a scene and goes to Studio. Widening
 * this to words or phrases would mean deciding typeface, layout and colour on
 * the user's behalf, which is a different feature.
 */
export type ImageRequest =
  | { kind: 'glyph'; text: string; lowercase: boolean }
  | { kind: 'scene'; prompt: string }

export function describeImageRequest(userPrompt: string): ImageRequest {
  const cleaned = stripRequestGrammar(userPrompt)
  if (!cleaned) return { kind: 'scene', prompt: userPrompt.trim() }

  const single = SINGLE_CHARACTER.exec(cleaned)
  const bare = BARE_CHARACTER.exec(cleaned)
  const character = single?.[5] ?? bare?.[1]
  if (character) {
    const modifier = single?.[2] ?? ''
    const lowercase = /lower/i.test(modifier) || /small/i.test(modifier)
    return {
      kind: 'glyph',
      text: lowercase ? character.toLowerCase() : character.toUpperCase(),
      lowercase,
    }
  }
  return { kind: 'scene', prompt: cleaned }
}
