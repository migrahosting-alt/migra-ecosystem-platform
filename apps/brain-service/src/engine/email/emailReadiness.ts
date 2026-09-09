/**
 * CONNECTION STATE → WHAT THE HUB SHOWS. One mapping, used everywhere.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THIS IS A PURE FUNCTION OF AN EXPLICIT CONNECTION
 *
 * A mailbox connection belongs to a PRINCIPAL, and the capability registry is
 * a process-wide singleton. Those two facts do not compose: readiness computed
 * from a cached provider on a shared object answers "is email available?" for
 * whoever connected most recently, and hands that answer to everybody else.
 *
 * That is not a display bug. A registry that reported one user's mailbox as
 * available to another is one wiring mistake away from executing against it.
 *
 * So the connection is resolved per request, by the route that knows who is
 * asking, and passed in. Nothing here reads shared state, which is what makes
 * "whose mailbox is this?" impossible to get wrong by omission.
 *
 * ---------------------------------------------------------------------------
 * ONE MAPPING, NOT TWO
 *
 * The authority object and the capability registry both need this answer. Two
 * copies would drift, and the drift would show as a hub row disagreeing with
 * the screen it opens.
 */

import type { CapabilityRemedy } from '../models/capabilityRegistry.js';
import type { EmailConnection } from './types.js';

export const EMAIL_NOT_CONFIGURED = 'Email is not set up yet.';
export const EMAIL_NOT_CONNECTED = 'Email is not connected yet.';
export const EMAIL_RECONNECT = 'Your email account needs reconnecting.';
export const EMAIL_UNAVAILABLE = 'Email is unavailable right now.';
export const EMAIL_READ_NOT_PERMITTED = 'Your email account is connected without permission to read mail.';

export interface EmailCapabilityReadiness {
  ready: boolean;
  reason?: string;
  /** Present ONLY when the user is the one who can fix it. */
  remedy?: CapabilityRemedy;
}

/**
 * Map a resolved connection to what the hub should show.
 *
 * `null` means the deployment has no email feature at all — no OAuth client, no
 * sealing key, or no durable store for it. That is an OPERATOR's problem and
 * carries no remedy: a Connect button would send a user to press something
 * that cannot help.
 */
export function emailReadinessFor(connection: EmailConnection | null): EmailCapabilityReadiness {
  if (!connection || connection.state === 'not_configured') {
    return { ready: false, reason: EMAIL_NOT_CONFIGURED };
  }

  switch (connection.state) {
    case 'not_connected':
      // Theirs to fix, right here.
      return { ready: false, reason: EMAIL_NOT_CONNECTED, remedy: 'connect-account' };

    case 'authorization_expired':
      /*
       * They DID connect. "Connect" would describe a first-time action and hide
       * that the authorization is what broke — which is also the only part they
       * can do anything about.
       */
      return { ready: false, reason: EMAIL_RECONNECT, remedy: 'reconnect-account' };

    case 'provider_unavailable':
      // The remedy is time. Offering a button here would have people
      // re-authorising a working account during an outage.
      return { ready: false, reason: EMAIL_UNAVAILABLE };

    case 'connected':
      /*
       * Connected is not the same as permitted. A grant that came back without
       * read scope would otherwise render as fully available and then refuse
       * every question — so the scope is checked here, and reconnecting is the
       * remedy because a wider consent is what fixes it.
       */
      if (!connection.scopes.read) {
        return { ready: false, reason: EMAIL_READ_NOT_PERMITTED, remedy: 'reconnect-account' };
      }
      return { ready: true };
  }
}
