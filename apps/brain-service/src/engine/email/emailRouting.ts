/**
 * FROM A SENTENCE TO A CAPABILITY CALL — and never to a provider.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THIS MODULE CANNOT READ MAIL
 *
 * It decides WHAT to invoke. It does not invoke it, does not hold a provider,
 * does not know a principal and cannot resolve a connection. That is the point:
 * a router that could call a provider directly would be a second path to a
 * mailbox — one that skips the availability gate, the scope check and the
 * per-caller resolution that the capability path enforces.
 *
 * The shortcut is always tempting, because it is shorter. It is also how a
 * mailbox gets read by code that never asked whose it was.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE INVOCATION CARRIES NO IDENTITY
 *
 * What comes out of here is a tool name and an input. The principal is attached
 * by the EXECUTOR, from the request's own identity — so a routing decision
 * cannot name a mailbox even if a prompt tries to.
 */

import { planEmail, type EmailPlan, type EmailPlanInput } from './plan.js';

/** The capability every mail read goes through. Named once. */
export const EMAIL_CAPABILITY = 'migra.email';

export type EmailRoute =
  /** Not about mail. The turn continues as it would have. */
  | { kind: 'not_email'; plan: EmailPlan }
  /** Invoke the capability with this input. No identity, by construction. */
  | { kind: 'capability'; tool: string; input: Record<string, unknown>; plan: EmailPlan }
  /**
   * About mail, and deliberately not served yet. Distinct from `not_email`
   * because the user asked for something real and deserves to be told it is not
   * available — rather than have their request quietly answered as chat.
   */
  | { kind: 'unsupported'; reason: string; plan: EmailPlan };

export interface EmailRouteInput extends EmailPlanInput {
  /** The thread already open in this turn, when there is one. */
  openThreadId?: string;
}

/**
 * Decide what a prompt means for the mailbox.
 *
 * The plan is produced by `planEmail`, which requires a verb and a mailbox noun
 * in one clause — a bare mention is not an intent. That guard exists because an
 * earlier version routed "My inbox is a disaster, anyway — what is the capital
 * of Peru?" into a mailbox search.
 */
export function routeEmail(input: EmailRouteInput): EmailRoute {
  const plan = planEmail(input);

  switch (plan.intent) {
    case 'no_email':
      return { kind: 'not_email', plan };

    case 'search_read':
      return {
        kind: 'capability',
        tool: EMAIL_CAPABILITY,
        /*
         * The prompt goes through as keywords. It is NOT parsed into structured
         * criteria here: a router that guessed `from:` from prose would quietly
         * narrow a search and report "no messages" for mail that exists.
         */
        input: { op: 'search', keywords: input.prompt, limit: 20 },
        plan,
      };

    case 'summarize':
      /*
       * Summarising means summarising SOMETHING. With a thread open it is that
       * thread; without one there is nothing identified to summarise, and
       * searching for a plausible candidate would pick a message the user never
       * named.
       */
      return input.openThreadId
        ? {
            kind: 'capability',
            tool: EMAIL_CAPABILITY,
            input: { op: 'readThread', threadId: input.openThreadId },
            plan,
          }
        : {
            kind: 'capability',
            tool: EMAIL_CAPABILITY,
            input: { op: 'search', keywords: input.prompt, limit: 20 },
            plan,
          };

    case 'draft':
    case 'send':
      /*
       * 🚨 NOT ROUTED. Governed send exists in the engine and is mutation-tested,
       * but it is not wired end to end and the connection holds read scope only.
       * Routing here would reach a capability that must refuse — so the refusal
       * is stated plainly instead, at the moment the user asked.
       */
      return {
        kind: 'unsupported',
        reason: 'MigraPilot can read your email, but cannot write or send it yet.',
        plan,
      };
  }
}
