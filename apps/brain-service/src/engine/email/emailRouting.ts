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
import { emailReadinessFor } from './emailReadiness.js';
import type { EmailConnection, EmailScopes } from './types.js';

/** The capability every mail read goes through. Named once. */
export const EMAIL_CAPABILITY = 'migra.email';

export type EmailRoute =
  /** Not about mail. The turn continues as it would have. */
  | { kind: 'not_email'; plan: EmailPlan }
  /** Invoke the capability with this input. No identity, by construction. */
  | { kind: 'capability'; tool: string; input: Record<string, unknown>; plan: EmailPlan }
  /**
   * A real mail request whose OPERATION needs an authority we may not hold.
   *
   * 🚨 NOT a hardcoded "we cannot send yet". The refusal is derived from the
   * caller's actual authorization state by `scopeRefusal`, so the day send
   * scope is granted this same route stops being refused — without anyone
   * remembering to delete a sentence. A hardcoded refusal is a promise that
   * outlives the condition it describes.
   */
  | { kind: 'requires_scope'; tool: string; needed: keyof EmailScopes; plan: EmailPlan };

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
       * 🚨 ROUTED AS MAIL, and refused on AUTHORITY rather than reclassified.
       *
       * Calling this `no_email` would be a wrong classification that happens to
       * be safe: the user asked to send mail, and answering as ordinary chat
       * leaves them believing the product did not understand them rather than
       * that sending is not authorised. Those are different facts and only one
       * of them is true.
       */
      return {
        kind: 'requires_scope',
        tool: EMAIL_CAPABILITY,
        needed: plan.intent === 'send' ? 'send' : 'draft',
        plan,
      };
  }
}

/* ------------------------------------------------------------------ *
 * Refusing on authority, not on a sentence
 * ------------------------------------------------------------------ */

export type ScopeVerdict =
  /** The caller holds it. The route is executable. */
  | { permitted: true }
  /** They do not, and this is why — in the engine's own words. */
  | { permitted: false; reason: string; remedy?: 'connect-account' | 'reconnect-account' };

/**
 * Can this caller perform the operation their prompt asked for?
 *
 * 🚨 DERIVED FROM THE CONNECTION, EVERY TIME. The alternative — a constant
 * saying "sending is not available yet" — is a claim about the product that
 * silently becomes false the day send scope is granted, and nothing would fail
 * to tell anyone. Reading the authorization state means the refusal disappears
 * on its own when it stops being true.
 *
 * The ORDER matters: an unconnected mailbox is not a missing scope. Telling
 * someone "not authorised to send" when they have not connected anything sends
 * them looking for a permission screen that does not apply to them.
 */
export function scopeRefusal(
  needed: keyof EmailScopes,
  connection: EmailConnection | null,
): ScopeVerdict {
  const readiness = emailReadinessFor(connection);
  if (!readiness.ready) {
    // Not connected, expired, unconfigured, unavailable — each already has the
    // right words and the right remedy. A scope message here would be wrong.
    return {
      permitted: false,
      reason: readiness.reason ?? 'Email is unavailable right now.',
      ...(readiness.remedy ? { remedy: readiness.remedy } : {}),
    };
  }

  if (connection?.scopes[needed]) return { permitted: true };

  /*
   * Connected, working, and simply not authorised for THIS operation.
   * Reconnecting is the remedy, because a wider consent is what grants it.
   */
  return {
    permitted: false,
    reason: needed === 'send'
      ? 'MigraPilot can read your email, but is not authorised to send it.'
      : 'MigraPilot can read your email, but is not authorised to write drafts in it.',
    remedy: 'reconnect-account',
  };
}
