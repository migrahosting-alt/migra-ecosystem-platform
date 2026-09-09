/**
 * WHEN A TURN IS ABOUT EMAIL — and, mostly, when it is not.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE WORD "MAIL" IS NOT AN INTENT
 *
 * "What is email?", "email me the details when you can", "rewrite this email
 * for me" — all contain the word and none of them wants a mailbox opened.
 * Routing on vocabulary would reach into someone's private correspondence
 * because a noun appeared, which is both a privacy failure and a latency cost
 * paid on every casual sentence.
 *
 * So the router asks for an ACTION over the mailbox: find, read, summarise,
 * reply, send. A bare mention is deliberately not enough.
 *
 * ---------------------------------------------------------------------------
 * WHY SEND IS ITS OWN INTENT AND NOT A DEGREE OF DRAFT
 *
 * They are governed completely differently. A draft has no side effect; a send
 * is irreversible and requires consent, an authorization recheck and a durable
 * claim. Collapsing them into "compose" would put the least reversible action
 * in the product behind the loosest classification in it.
 *
 * ---------------------------------------------------------------------------
 * ATTACHMENTS BEAT MAIL, EXCEPT WHEN THE MAILBOX IS THE SUBJECT
 *
 * "Summarise this" with a file attached is about the file. But "find the email
 * with this invoice attached" is about the mailbox even though a file is
 * present — so the check is ordered rather than absolute.
 */

export type EmailIntent = 'search_read' | 'summarize' | 'draft' | 'send' | 'no_email';

export type EmailReasonCode =
  | 'explicit_search'
  | 'sender_reference'
  | 'mailbox_state'
  | 'thread_summary'
  | 'reply_request'
  | 'send_request'
  | 'incidental_mention'
  | 'supplied_text_rewrite'
  | 'grounded_in_attachment'
  | 'general_question'
  | 'web_intent';

export interface EmailPlan {
  intent: EmailIntent;
  reason: EmailReasonCode;
  /** One sentence for the trace. Never shown to a user as-is. */
  explanation: string;
}

export interface EmailPlanInput {
  prompt: string;
  attachments?: readonly string[];
  /** True when the turn already has a thread open. Changes what "summarise this" means. */
  hasOpenThread?: boolean;
}

const plan = (intent: EmailIntent, reason: EmailReasonCode, explanation: string): EmailPlan => ({
  intent,
  reason,
  explanation,
});

/**
 * An ACTION over the mailbox, not a mention of one.
 *
 * The verb and the noun must appear together, within one clause. A first
 * version matched them anywhere in the prompt and routed "My inbox is a
 * disaster, anyway — what is the capital of Peru?" into a mailbox search: the
 * noun was present, no action was requested, and the router opened someone's
 * mail to answer a geography question.
 */
const SEARCH =
  /\b(find|search|look for|show|check|list|pull up|any)\b[^.?!]{0,60}?\b(e-?mails?|messages?|inbox|mailbox|unread)\b/i;
const FROM_SENDER = /\b(e-?mail|message|note)\b[^.?!]*\bfrom\b|\bwhat did\b[^.?!]*\b(say|write|send)\b/i;

/**
 * A mailbox STATE word — "unread", "starred" — is a qualifier, not a request.
 *
 * 🚨 It is deliberately NOT sufficient on its own. Standing alone it matched
 * any sentence containing "inbox", which is how an incidental complaint became
 * a search. It now only strengthens a prompt that already asked for something.
 */
const MAILBOX_STATE = /\b(unread|starred|archived|spam)\b[^.?!]{0,40}?\b(e-?mails?|messages?|mail)\b|\b(e-?mails?|messages?)\b[^.?!]{0,40}?\b(unread|starred|archived)\b/i;

const SUMMARIZE = /\b(summari[sz]e|summary of|catch me up|what.s in)\b/i;

/**
 * A mailbox the user is POINTING AT — "my emails", "the messages", "our inbox".
 *
 * 🚨 THE DETERMINER IS THE WHOLE GUARD, and it is why this is not just a noun
 * list. "Summarise what you know about email marketing" contains the noun and
 * must not open a mailbox; "summarise the emails about the invoice" points at
 * one and must. A bare noun cannot tell those apart, and the earlier version of
 * this file was burned by exactly that class of over-match.
 */
const MAILBOX_POSSESSED = /\b(my|our|the|these|those|his|her|their)\s+(e-?mails?|messages?|mail|inbox)\b/i;
const THREAD = /\b(thread|conversation|this e-?mail|these e-?mails)\b/i;

const REPLY = /\b(draft|write|compose|prepare)\b[^.?!]*\b(reply|response|answer|e-?mail|message)\b|\breply to\b|\brespond to\b/i;
const FORWARD = /\bforward\b/i;

/**
 * Sending. Still never inferred from "reply" — that is a draft.
 *
 * 🚨 WIDENED DELIBERATELY. The narrow form matched "send it" and "send the
 * email" but not "send AN email to X", which is how people actually ask. That
 * gap classified an explicit send request as `no_email`, and the turn was then
 * answered as ordinary chat — which is not a neutral failure. It is a wrong
 * classification that happens to be safe, and it leaves the user believing the
 * product simply did not understand them rather than that sending is not yet
 * authorised.
 */
const SEND = /\b(send it|send this|send that|send now|go ahead and send|send (an?|the|another) (e-?mail|message|note|reply))\b/i;

/** Asking for supplied text to be changed. The material is in the prompt. */
const REWRITE_SUPPLIED =
  /\b(rewrite|reword|rephrase|proofread|fix the grammar)\b|\bmake (this|it|the)\b[^.?!]{0,30}?\b(shorter|longer|clearer|more polite|more formal)\b/i;

/** A question ABOUT email as a topic, not a request to open one. */
const ABOUT_EMAIL = /\b(what is|what.s|how does|explain|define)\b[^.?!]*\b(e-?mail|smtp|imap)\b/i;

const WEB = /\b(search (the )?web|latest|current price|news about)\b/i;

export function planEmail(input: EmailPlanInput): EmailPlan {
  const prompt = input.prompt.trim();
  const hasAttachments = (input.attachments?.length ?? 0) > 0;

  if (prompt.length === 0) return plan('no_email', 'general_question', 'Nothing was asked.');

  /*
   * 1. A QUESTION ABOUT EMAIL is not a request to open one. Checked first
   *    because "what is email" contains the strongest noun there is.
   */
  if (ABOUT_EMAIL.test(prompt)) {
    return plan('no_email', 'general_question', 'This asks about email as a subject.');
  }

  /*
   * 2. REWRITING SUPPLIED TEXT needs no mailbox. "Rewrite this email for me"
   *    is about the words in the prompt, and opening a mailbox to answer it
   *    would be both useless and intrusive.
   */
  if (REWRITE_SUPPLIED.test(prompt)) {
    return plan('no_email', 'supplied_text_rewrite', 'The material is already in the prompt.');
  }

  // 3. Sending, before drafting — "send the reply I drafted" is a send.
  if (SEND.test(prompt)) {
    return plan('send', 'send_request', 'The user asked to send a message.');
  }

  if (REPLY.test(prompt) || FORWARD.test(prompt)) {
    return plan('draft', 'reply_request', 'The user asked for a message to be composed.');
  }

  /*
   * 4. SUMMARISING. With a file attached and no mailbox action, "summarise
   *    this" is about the file — but an open thread makes it about the thread.
   */
  if (SUMMARIZE.test(prompt)) {
    if (THREAD.test(prompt) || input.hasOpenThread) {
      return plan('summarize', 'thread_summary', 'The user asked for a conversation to be summarised.');
    }
    if (MAILBOX_STATE.test(prompt) || SEARCH.test(prompt) || MAILBOX_POSSESSED.test(prompt)) {
      return plan('summarize', 'mailbox_state', 'The user asked for a summary of mail.');
    }
    if (hasAttachments) {
      return plan('no_email', 'grounded_in_attachment', 'The question is about an attached file.');
    }
  }

  /*
   * 5. A file the user attached wins over an incidental mention — but not over
   *    an explicit mailbox action, which is why this sits below the search
   *    checks that follow rather than above them.
   */
  if (SEARCH.test(prompt)) {
    return plan('search_read', 'explicit_search', 'The user asked to find mail.');
  }
  if (FROM_SENDER.test(prompt)) {
    return plan('search_read', 'sender_reference', 'The user referred to a message from someone.');
  }
  if (MAILBOX_STATE.test(prompt)) {
    return plan('search_read', 'mailbox_state', 'The user referred to a state of their mailbox.');
  }

  if (hasAttachments) {
    return plan('no_email', 'grounded_in_attachment', 'The question is about an attached file.');
  }
  if (WEB.test(prompt)) {
    return plan('no_email', 'web_intent', 'This is a question about the web.');
  }

  /*
   * 6. 🚨 A BARE MENTION IS NOT AN INTENT. Reaching this point means the word
   *    appeared without any action over a mailbox.
   */
  if (/\b(e-?mails?|inbox|mailbox)\b/i.test(prompt)) {
    return plan('no_email', 'incidental_mention', 'Email was mentioned, but nothing was asked of the mailbox.');
  }

  return plan('no_email', 'general_question', 'Nothing about this turn concerns email.');
}
