/**
 * THE REAL REGISTRY'S VOCABULARY.
 *
 * ---------------------------------------------------------------------------
 * 🚨 A FAKE PROVES THE SHAPE OF A CONTRACT; IT CANNOT PROVE ANYONE IMPLEMENTED IT
 *
 * The selector's own suite runs against hand-written capabilities, which is
 * right — it must stay generic over capabilities that do not exist yet. But
 * every one of those tests would keep passing if the real registry declared no
 * vocabulary at all, and chat would then select nothing for every prompt while
 * the suite stayed green.
 *
 * So this asks the REGISTRY, and puts its answer through the REAL selector.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CapabilityRegistry } from '../src/engine/models/capabilityRegistry.js';
import { selectCapabilities } from '../src/engine/models/capabilitySelection.js';

const registry = new CapabilityRegistry();

/**
 * Exactly what a chat turn is given.
 *
 * 🚨 THE CATALOG AND THE READINESS COME FROM DIFFERENT PLACES, ON PURPOSE.
 * `includeUnavailable` asks for the full catalog — the registry is a singleton
 * and its context-free `available` is a global answer to a per-principal
 * question. Availability is supplied separately, resolved from THIS caller's
 * own connection, which is the invariant a mailbox capability exists under.
 */
const catalog = () => registry.list({ includeUnavailable: true });
const selectable = (available: string[]) => catalog().map((d) => ({
  id: d.id,
  nouns: d.nouns,
  available: available.includes(d.id),
}));

test('🚨 the email capability declares its own vocabulary, including "thread"', () => {
  const email = catalog().find((d) => d.id === 'migra.email');
  assert.ok(email, 'the email capability is not registered');

  /*
   * `thread` is the one that was missing. "Summarize the thread" selected
   * nothing until Email declared it — and the fix belonged here rather than in
   * the selector, which must not learn one capability's words.
   */
  assert.ok(email!.nouns.includes('thread'), 'Email does not own the word "thread"');
  assert.ok(email!.nouns.includes('email'));
  assert.ok(email!.nouns.includes('inbox'));
});

test('🚨 a mailbox request selects the real email capability, through the real selector', () => {
  const plan = selectCapabilities({
    prompt: 'search my inbox for the September invoice',
    capabilities: selectable(['migra.email']),
    identified: true,
  });

  assert.deepEqual(plan.selected.map((c) => c.capabilityId), ['migra.email']);
  assert.equal(plan.selected[0]!.reason, 'object-of-request');
  // 🚨 And the repository is NOT pre-loaded, so the model has no source files
  // in front of it to answer a mailbox question from instead.
  assert.equal(plan.repoPlanning, false);
});

test('🚨 "summarize the thread" — the case the missing noun broke — now selects', () => {
  const plan = selectCapabilities({
    prompt: 'summarize the thread',
    capabilities: selectable(['migra.email']),
    identified: true,
  });

  assert.deepEqual(plan.selected.map((c) => c.capabilityId), ['migra.email']);
});

test('🚨 no OTHER registered capability claims a mail word', () => {
  /*
   * A word two capabilities would both claim means the vocabulary is too
   * broad — not that the selector needs a tie-break. This fails the moment a
   * new registration reaches for one of these, which is the point.
   */
  const mail = new Set(['email', 'mail', 'mailbox', 'inbox', 'message', 'messages', 'thread', 'emails']);
  const overlaps = catalog()
    .filter((d) => d.id !== 'migra.email')
    .filter((d) => d.nouns.some((n) => mail.has(n)))
    .map((d) => d.id);

  assert.deepEqual(overlaps, [], 'another capability claims a word Email owns');
});

test('🚨 a repository question reaches NO capability and keeps repository planning', () => {
  const plan = selectCapabilities({
    prompt: 'where is the rate limiter implemented in this repo?',
    capabilities: selectable(['migra.email']),
    identified: true,
  });

  assert.deepEqual(plan.selected, []);
  assert.equal(plan.repoPlanning, true);
});

test('🚨 an unidentified request selects nothing, whatever it says', () => {
  const plan = selectCapabilities({
    prompt: 'search my inbox for the September invoice',
    capabilities: selectable(['migra.email']),
    identified: false,
  });

  assert.deepEqual(plan.selected, []);
  // Rejected as unavailable rather than as un-matched: an unidentified caller
  // must not be able to tell the difference from the outside.
  assert.ok(plan.rejected.some((r) => r.capabilityId === 'migra.email'));
});

test('🚨 a capability with NO declared vocabulary is never selected by chat', () => {
  const terminal = catalog().find((d) => d.id === 'terminal.exec');
  assert.ok(terminal, 'terminal.exec is not registered');
  assert.deepEqual([...terminal!.nouns], [], 'a shell declared chat vocabulary');

  const plan = selectCapabilities({
    prompt: 'run the terminal command to list files',
    capabilities: selectable(['terminal.exec']),
    identified: true,
  });
  assert.equal(plan.selected.some((c) => c.capabilityId === 'terminal.exec'), false,
    'a chat prompt selected a shell');
});
