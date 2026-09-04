// A forgotten conversation must be recovered from; everything else must not be.
//
// MEASURED 2026-09-04: the panel held a conversation id while the Brain reported
// ZERO conversations. The stored id outlives the Brain that issued it — the session
// store is in-memory, so every restart forgets every conversation. The 404 was
// caught, written to an output channel nobody had open, and the dead id was kept
// forever, so every later turn carried an id the engine did not know. Memory was
// silently OFF while the UI showed it on.
//
// The risk in fixing it is over-reach: this predicate DELETES the user's
// conversation, so it must fire for exactly one condition and nothing adjacent.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PilotError } from '@migrapilot/pilot-client';
import {
  conversationWasForgotten,
  FORGOTTEN_CONVERSATION_CODE,
  FORGOTTEN_CONVERSATION_NOTICE,
} from '../../panel/shell/conversationRecovery.js';

test('the engine saying it has no such conversation is recovered from', () => {
  const err = new PilotError('CAPABILITY_MISSING', 'Engine tool responded 404 (UNKNOWN_CONVERSATION).', {
    httpStatus: 404,
    serverCode: FORGOTTEN_CONVERSATION_CODE,
  });
  assert.equal(conversationWasForgotten(err), true);
});

test('a bare 404 does NOT delete a live conversation', () => {
  // CAPABILITY_MISSING is the mapped code for every 404 AND every 403 — a missing
  // route, a revoked scope, a typo in a path. Resetting on the mapped code alone
  // would throw away a working conversation because one unrelated request missed.
  const err = new PilotError('CAPABILITY_MISSING', 'Engine tool responded 404.', { httpStatus: 404 });
  assert.equal(conversationWasForgotten(err), false);
});

test('neither does an unrelated server code that happens to 404', () => {
  const err = new PilotError('CAPABILITY_MISSING', 'Engine tool responded 404 (NO_SUCH_TOOL).', {
    httpStatus: 404,
    serverCode: 'NO_SUCH_TOOL',
  });
  assert.equal(conversationWasForgotten(err), false);
});

test('nor a transport failure, which is transient and must be retried, not erased', () => {
  assert.equal(conversationWasForgotten(new PilotError('NETWORK', 'connection reset')), false);
  assert.equal(conversationWasForgotten(new Error('boom')), false);
  assert.equal(conversationWasForgotten(undefined), false);
});

test('the notice states the loss plainly and names the cause', () => {
  // "Restoring…" or silence would both imply the history is coming back.
  assert.match(FORGOTTEN_CONVERSATION_NOTICE, /could not be restored/);
  assert.match(FORGOTTEN_CONVERSATION_NOTICE, /restarted/, 'actionable cause, not "something went wrong"');
  assert.doesNotMatch(FORGOTTEN_CONVERSATION_NOTICE, /retry|restoring|please wait/i);
});
