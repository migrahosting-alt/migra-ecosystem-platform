// Is there an actual answer here, or only punctuation?
//
// Measured: an Explain returned a title, a provenance line and an unterminated
// code fence — 67 bytes, no error — and the command opened it as a finished
// document. Nothing failed, so nothing said so, and the user was shown an empty
// page presented as the answer.
//
// This is deliberately crude and generous. It looks for the difference between
// "an answer" and "no answer", NOT for quality: a wrong answer is still an
// answer, and judging that belongs to the reader, not to this check.

/** Minimum prose, after markup is discounted, for content to count as an answer. */
export const MIN_SUBSTANTIVE_CHARS = 40;

export function isSubstantiveAnswer(content: string | undefined): boolean {
  if (!content) return false;
  const stripped = content
    .replace(/^```[^\n]*$/gm, '')   // fence markers, opened or closed
    .replace(/^#{1,6}\s.*$/gm, '')  // headings
    .replace(/^_.*_$/gm, '')        // the provenance stamp line
    .replace(/^[-*+>\s]+$/gm, '')   // bare bullets and rules
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= MIN_SUBSTANTIVE_CHARS;
}

/** What to tell someone when the model produced nothing. Never blames them. */
export const EMPTY_ANSWER_MESSAGE =
  'MigraPilot produced no usable answer for this request. Nothing failed — the model returned an empty response — so there is nothing to show. Try again, or narrow the selection.';
