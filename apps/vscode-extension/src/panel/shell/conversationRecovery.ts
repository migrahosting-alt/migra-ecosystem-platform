/**
 * Has the engine FORGOTTEN the conversation we are holding an id for?
 *
 * 🚨 THIS IS A NARROW QUESTION AND MUST STAY NARROW. Answering `true` throws away
 * the user's conversation id and their restored history, so it may only be true for
 * the one condition that actually means the conversation is gone.
 *
 * The condition exists because the id outlives the Brain that issued it: the
 * session store is in-memory, so every restart forgets every conversation. Measured
 * 2026-09-04 — the panel held an id while the Brain reported zero conversations, and
 * the 404 was written to an output channel nobody had open. Memory was silently OFF
 * while the UI showed it on, which is worse than not having memory at all, because
 * the user keeps relying on it.
 *
 * 🚨 A BARE 404 IS NOT ENOUGH. `CAPABILITY_MISSING` is the mapped code for every 404
 * AND every 403 — a missing route, a revoked scope, a typo in a path. Resetting on
 * that would delete a live conversation because one unrelated request went missing.
 * Only the engine's own `UNKNOWN_CONVERSATION` says the conversation itself is gone,
 * which is why that code is carried as data on the error rather than left inside the
 * human-readable message.
 *
 * © MigraTeck LLC.
 */

import { isPilotError } from '@migrapilot/pilot-client';

/** The engine's code for "I have no such conversation". */
export const FORGOTTEN_CONVERSATION_CODE = 'UNKNOWN_CONVERSATION';

export function conversationWasForgotten(error: unknown): boolean {
  return isPilotError(error) && error.serverCode === FORGOTTEN_CONVERSATION_CODE;
}

/**
 * What the user is told, once, when it happens.
 *
 * It states the loss plainly and does not dress it up: "restoring…" or silence
 * would both imply the history is coming back. It also names the cause, because
 * "the engine restarted" is actionable context and "something went wrong" is not.
 */
export const FORGOTTEN_CONVERSATION_NOTICE =
  'Earlier messages could not be restored — the engine restarted since. Starting a new conversation.';
