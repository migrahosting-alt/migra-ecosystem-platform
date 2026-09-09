/**
 * THE GROUNDED SUMMARY — what a model is given, and what is added afterwards.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE DISCLOSURE IS ATTACHED, NOT REQUESTED
 *
 * A partial summary must say it is partial. The obvious implementation asks the
 * model to say so in its prose — and that fails the way every instruction to a
 * model eventually fails: silently, on the occasion nobody was watching, in an
 * answer that reads perfectly.
 *
 * So the model is never asked. `renderSummary` appends the sentence when the
 * evidence is partial, and there is no path through this file that produces
 * prose from partial evidence without it.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE CONTEXT IS BUILT FROM `statableFacts`, NOT FROM MESSAGES
 *
 * A message object carries fields evidence does not license — provider ids,
 * labels, raw headers, a body that may be a snippet. Handing the whole object
 * to a model invites it to state any of them, and a summary that names a label
 * or a message id has left what was retrieved.
 *
 * ---------------------------------------------------------------------------
 * 🚨 SCOPE IS INHERITED, NOT RE-DERIVED
 *
 * Nothing here fetches anything. It consumes evidence that a per-caller read
 * already produced, so a summary cannot reach outside the connection that
 * produced its sources — there is no store, no provider and no principal in
 * this file to reach with.
 */

import {
  SNIPPET_LIMITATION,
  statableFacts,
  type EmailMessageEvidence,
  type EmailSummaryEvidence,
} from './evidence.js';

/** One message, reduced to what may be said about it. */
export interface SummarySource {
  evidenceId: string;
  from: string;
  subject: string;
  sentAt: string;
  text: string;
  textIsComplete: boolean;
}

export interface SummaryContext {
  sources: SummarySource[];
  /** True only when every source was a complete body. */
  complete: boolean;
  /** The sentence a partial summary carries. Empty when complete. */
  disclosure: string;
}

export type SummaryContextRefusal =
  | { kind: 'missing_source'; detail: string }
  | { kind: 'no_sources'; detail: string };

/**
 * Assemble what the model may read.
 *
 * Refuses when the evidence cites a message that is not present. That is not a
 * defensive nicety: summary evidence and the retrieved set can drift apart
 * across a turn, and a summariser handed a citation it cannot resolve would
 * either omit it silently or describe a message it never saw.
 */
export function summaryContextFrom(input: {
  evidence: EmailSummaryEvidence;
  available: readonly EmailMessageEvidence[];
}): { ok: true; context: SummaryContext } | { ok: false; refusal: SummaryContextRefusal } {
  if (input.evidence.sourceMessageIds.length === 0) {
    return { ok: false, refusal: { kind: 'no_sources', detail: 'a summary needs at least one message' } };
  }

  const byId = new Map(input.available.map((m) => [m.id, m]));
  const sources: SummarySource[] = [];

  for (const id of input.evidence.sourceMessageIds) {
    const message = byId.get(id);
    if (!message) {
      return {
        ok: false,
        refusal: { kind: 'missing_source', detail: `the summary cites a message that is not available: ${id}` },
      };
    }
    // Only what evidence licenses. Never the message object.
    sources.push({ evidenceId: message.id, ...statableFacts(message) });
  }

  /*
   * 🚨 COMPLETENESS IS RE-DERIVED FROM THE SOURCES, not copied from the
   * evidence's flag. The two should agree; if they ever do not, the sources are
   * the ground truth and the flag is a claim about them.
   */
  const complete = sources.every((s) => s.textIsComplete);

  return {
    ok: true,
    context: { sources, complete, disclosure: complete ? '' : SNIPPET_LIMITATION },
  };
}

/**
 * What the model is told it may do.
 *
 * Stated as constraints rather than encouragement: a prompt that says "be
 * accurate" and one that says "state only what appears below" produce very
 * different failures.
 */
export function summaryInstructions(context: SummaryContext): string {
  return [
    'Summarise the email messages below.',
    'State only what appears in them. Do not infer, do not add context, and do not guess at anything a message does not say.',
    'If the messages do not answer the question, say what they do say and stop.',
    context.complete
      ? ''
      : 'Some messages below are previews rather than full text. Do not describe what a preview does not contain.',
  ].filter(Boolean).join('\n');
}

/**
 * The material itself.
 *
 * Each source is labelled with whether its text is complete, so the model can
 * see per-message what it is working from — the aggregate flag cannot express
 * that one of four messages was truncated.
 */
export function summaryMaterial(context: SummaryContext): string {
  return context.sources
    .map((s, index) => [
      `--- message ${index + 1} of ${context.sources.length} ---`,
      `From: ${s.from}`,
      `Subject: ${s.subject}`,
      `Sent: ${s.sentAt}`,
      s.textIsComplete ? 'Body (complete):' : 'Body (PREVIEW ONLY — truncated by the provider):',
      s.text,
    ].join('\n'))
    .join('\n\n');
}

/**
 * Attach the disclosure.
 *
 * 🚨 THE MODEL IS NOT ASKED TO DO THIS, and the check is not "did it mention
 * previews". Appending is the only implementation that cannot be forgotten on
 * the one answer nobody reads.
 *
 * The sentence is not duplicated when the prose already ends with it — which
 * happens when a model follows the instruction anyway — because the same
 * caveat twice reads as a fault in the product.
 */
export function renderSummary(prose: string, context: SummaryContext): string {
  const body = prose.trim();
  if (context.complete || !context.disclosure) return body;
  if (body.includes(context.disclosure)) return body;
  return body.length > 0 ? `${body}\n\n${context.disclosure}` : context.disclosure;
}
