/**
 * Does the user's own message GREET in Haitian Creole?
 *
 * 🚨 WHY THIS IS NOT A SUBSTRING TEST ANY MORE.
 *
 * The disambiguation hint ships only on turns where the user wrote a Creole
 * greeting, because measured unconditionally it flipped English answers into
 * malformed Creole on 5 of 12 identical runs. The gate that fixed that asked
 * whether a greeting APPEARED IN the message:
 *
 *     new RegExp(`\\b${greeting}\\b`, 'i').test(prompt)
 *
 * Appearing-in is not is. An owner testing the product typed the English
 * correction "it suppose to be Bonswa" — an English sentence that happens to
 * contain a Creole word. The gate fired, the reply flipped to Creole, and the
 * model answered the WORD `Bonswa` as a greeting instead of obeying the
 * SENTENCE about it. Every further correction that named the right word
 * re-triggered the same flip, so the user could not correct their way out.
 * Measured 3/3 in Creole with the token present, 3/3 in English with
 * "good evening" in its place.
 *
 * So the gate now tests INTENT: is this message a greeting, or a message that
 * mentions one? Two independent conditions, both required.
 *
 *   1. USE, NOT MENTION. A greeting inside quotes is being talked about.
 *   2. IT OPENS THE MESSAGE, and nothing around it is foreign syntax.
 *
 * Condition 2 is what separates "Bonjou, kijan ou ye?" from "what does bonswa
 * mean?". A greeting used as a greeting comes first; a greeting being
 * discussed is the object of a sentence built in some other language.
 *
 * DELIBERATELY NOT A SPELLING MAP. Nothing here rewrites, corrects or
 * substitutes a single character of what the user wrote. It only decides
 * whether one sentence of context ships, and the user's text reaches the model
 * byte-for-byte either way.
 */

/**
 * The greetings the hint exists for — routinely misread as Indonesian, Malay
 * or a typo. This list is also what the hint itself quotes, so it is exported
 * rather than duplicated.
 */
export const CREOLE_GREETINGS = [
  'sak pase',
  'sa k ap fet',
  'kijan ou ye',
  'n ap boule',
  'bonjou',
  'bonswa',
] as const;

/**
 * Words that are unambiguously NOT Haitian Creole. Their presence means the
 * sentence around the greeting was built in English or French, which makes the
 * greeting a subject rather than an act.
 *
 * 🚨 EVERY ENTRY WAS CHECKED AGAINST CREOLE, because a false entry here would
 * silently switch the hint off for real Creole speakers. Deliberately EXCLUDED
 * despite looking French: `la` and `a` (Creole definite articles), `ou` (Creole
 * "you", not French "or"), `se` (Creole "is"), `nou`, `li`, `yo`, `pa`, and
 * `merci`/`mèsi`, whose accent-stripped forms collide.
 */
const FOREIGN_SYNTAX = [
  // English function words and the vocabulary of correction and definition,
  // which is how a greeting gets discussed rather than used.
  'i', 'it', 'its', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'the', 'to', 'of', 'and', 'but', 'not', 'should', 'would', 'could',
  'suppose', 'supposed', 'mean', 'means', 'meant', 'meaning',
  'say', 'says', 'said', 'spell', 'spelled', 'spelling', 'write', 'written',
  'correct', 'correction', 'wrong', 'instead', 'actually',
  'what', 'when', 'where', 'why', 'how', 'who', 'does', 'do', 'did',
  'you', 'your', 'my', 'we', 'they',
  'translate', 'translation', 'word', 'english', 'french', 'creole',
  'hello', 'hi', 'please', 'thanks',
  // French. `la`, `ou`, `se` and `a` are absent on purpose — see above.
  'le', 'les', 'une', 'des', 'est', 'vous', 'tu', 'je', 'ce', 'cette',
  'que', 'qui', 'comment', 'pourquoi', 'veut', 'dire', 'signifie',
  'bonjour', 'salut', 'coucou',
] as const;

/** Quoted spans, in the quote characters a person actually types. */
const QUOTED_SPAN = /"[^"]*"|'[^']*'|`[^`]*`|«[^»]*»|“[^”]*”|‘[^’]*’/g;

function wholeWord(phrase: string, anchored: boolean): RegExp {
  // Greetings are multi-word; a typed one may carry any run of whitespace.
  const body = phrase.replace(/ /g, '\\s+');
  return new RegExp(`${anchored ? '^' : '\\b'}${body}\\b`, 'i');
}

/**
 * True only when the message GREETS in Creole.
 *
 * The caller passes the user's OWN message and nothing else — never retrieved
 * documents, which are the user's content rather than a statement about the
 * language they are writing to us in.
 */
export function creoleGreetingIntent(userPrompt: string | undefined): boolean {
  /*
   * 🚨 A TURN MAY CARRY NO TEXT AT ALL. An image-only turn reaches the provider
   * with `userPrompt` undefined. The substring gate this replaced survived that
   * by accident — `RegExp.test(undefined)` coerces to the string "undefined"
   * and quietly returns false — whereas calling `.replace` on it throws and
   * takes the whole generation down. Caught by the long-running inference
   * tests, not by anything about Creole. No text is no greeting.
   */
  if (typeof userPrompt !== 'string' || !userPrompt) return false;

  // 1. USE, NOT MENTION. Quoted text is being discussed; drop it before asking
  //    anything else, so `the word "bonswa" is...` cannot open with a greeting.
  const used = userPrompt.replace(QUOTED_SPAN, ' ');

  // 2a. IT OPENS THE MESSAGE. Leading punctuation, whitespace and emoji are
  //     noise a greeting is routinely typed behind.
  const opening = used.replace(/^[\s\p{P}\p{S}]+/u, '');
  const opensWithGreeting = CREOLE_GREETINGS.some((greeting) =>
    wholeWord(greeting, true).test(opening),
  );
  if (!opensWithGreeting) return false;

  // 2b. NOTHING AROUND IT IS FOREIGN SYNTAX. This catches the message that
  //     opens with the greeting and then discusses it — `bonswa means good
  //     evening` — which 2a alone would let through.
  let remainder = used;
  for (const greeting of CREOLE_GREETINGS) {
    remainder = remainder.replace(
      new RegExp(`\\b${greeting.replace(/ /g, '\\s+')}\\b`, 'gi'),
      ' ',
    );
  }
  return !FOREIGN_SYNTAX.some((foreign) => wholeWord(foreign, false).test(remainder));
}
