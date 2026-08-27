/**
 * Turning a provider's failure into something the user can act on.
 *
 * Every model failure used to reach the user as one sentence — "The engine could
 * not complete the request." That is true, and it is nearly useless: it reads as
 * "something broke inside, wait and try later" for causes where the user holds
 * the fix and could apply it in ten seconds.
 *
 * 🚨 The cost of that ambiguity is measured, not theoretical. An unreadable
 * image and a saturated GPU produced the SAME sentence, and during the image
 * lane I spent real time attributing a broken 133-byte PNG to GPU contention —
 * contention that was genuinely happening at the time, which is exactly what
 * made the wrong explanation so easy to believe. The product had the provider's
 * actual words ("Failed to load image or audio file") and threw them away.
 *
 * So this maps provider text to a cause ONLY where the mapping is unambiguous.
 * Anything else stays `unknown` and keeps the generic sentence: a confident
 * wrong diagnosis is worse than an honest vague one, because the user acts on it.
 */

/** Causes worth naming. `unknown` is the honest default, not a failure here. */
export type ProviderFailureKind = 'unreadable_image' | 'unknown';

export interface ProviderFailure {
  kind: ProviderFailureKind;
  /** Stable machine code for the client. */
  code: string;
  /** What the user is told. Actionable when we know the cause. */
  message: string;
}

const GENERIC: ProviderFailure = {
  kind: 'unknown',
  code: 'COMPLETION_FAILED',
  message: 'The engine could not complete the request.',
};

/*
 * Phrases that mean "the bytes were not a usable image".
 *
 * Deliberately narrow. Each names an image explicitly, so a generic transport
 * failure on a turn that happened to carry an attachment cannot match — that
 * would blame the user's file for the server's outage and send them off
 * re-encoding a perfectly good photo.
 *
 * The first is Ollama's own wording, observed live; the rest cover the
 * OpenAI-compatible servers and the Pillow-based backends behind them.
 */
const UNREADABLE_IMAGE: readonly RegExp[] = [
  /failed to load image/i,
  /unable to (?:load|decode|process|read) (?:the )?image/i,
  /invalid image/i,
  /cannot identify image file/i,
  /unsupported image (?:format|type|mime)/i,
  /image (?:decode|decoding) (?:failed|error)/i,
  /corrupt(?:ed)? image/i,
];

const IMAGE_UNREADABLE_MESSAGE =
  'That image could not be read. The file may be corrupt, truncated, or in a format '
  + 'the vision model does not accept — re-saving it as a PNG or JPEG and attaching it '
  + 'again usually fixes it.';

/**
 * Classify the last provider error of a turn.
 *
 * Takes the already-extracted text rather than the error object: the failover
 * loops keep the string (they log it), the thrown types vary per provider, and a
 * classifier that cannot be handed a plain string is a classifier that is
 * painful to test.
 */
export function classifyProviderFailure(errorText: string | undefined): ProviderFailure {
  if (!errorText) return GENERIC;

  if (UNREADABLE_IMAGE.some((re) => re.test(errorText))) {
    return { kind: 'unreadable_image', code: 'IMAGE_UNREADABLE', message: IMAGE_UNREADABLE_MESSAGE };
  }

  return GENERIC;
}
