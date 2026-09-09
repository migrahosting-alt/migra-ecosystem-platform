/**
 * WHAT IS THIS REQUEST ABOUT — decided before any evidence is planned.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE LIVE FAILURE THIS EXISTS TO PREVENT
 *
 * Asked to find an email, the repository planner scored `telemetry.ts` at 506
 * on "identifier email", pre-loaded four source files, and the mailbox was
 * never opened. The model answered from the repository evidence in front of it.
 *
 * The bug was ORDERING. Teaching the repo planner about email would have made
 * it a second capability router; scoring capabilities against keywords here
 * would repeat that one layer up, and "email marketing strategy" would open a
 * mailbox.
 *
 * So selection asks a structural question: is the capability's noun the OBJECT
 * of the request, or is it modifying a different noun?
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { selectCapabilities } from '../src/engine/models/capabilitySelection.js';

const MAIL = { id: 'migra.email', nouns: ['email', 'mail', 'inbox', 'message'], available: true };
const SEARCH = { id: 'migra.search', nouns: ['web', 'internet'], available: true };
const CAPS = [MAIL, SEARCH];

const plan = (prompt: string, over: { caps?: typeof CAPS; identified?: boolean } = {}) =>
  selectCapabilities({
    prompt,
    capabilities: over.caps ?? CAPS,
    identified: over.identified ?? true,
  });

const chose = (p: ReturnType<typeof plan>, id: string) => p.selected.some((s) => s.capabilityId === id);

/* ------------------------------------------------------------------ *
 * 🚨 1 + 2. Explicit mailbox intent
 * ------------------------------------------------------------------ */

test('🚨 1. "Find the email containing MIGRA_EMAIL_SENTINEL_0909" selects the mailbox and skips repo planning', () => {
  const p = plan('Find the email containing MIGRA_EMAIL_SENTINEL_0909');
  assert.equal(chose(p, 'migra.email'), true, 'the mailbox was not selected');
  assert.equal(p.repoPlanning, false, 'repository evidence was planned for a mailbox request');
  assert.equal(p.selected[0]!.reason, 'object-of-request');
});

test('🚨 2. "Summarize that email" selects the mailbox', () => {
  const p = plan('Summarize that email');
  assert.equal(chose(p, 'migra.email'), true);
  assert.equal(p.repoPlanning, false);
});

test('a mailbox request does not drag in unrelated capabilities', () => {
  const p = plan('Find the email containing MIGRA_EMAIL_SENTINEL_0909');
  assert.equal(chose(p, 'migra.search'), false);
  assert.ok(p.rejected.some((r) => r.capabilityId === 'migra.search' && r.reason === 'no-owned-noun'));
});

/* ------------------------------------------------------------------ *
 * 🚨 5 + 6. Incidental words must not open a mailbox
 * ------------------------------------------------------------------ */

test('🚨 5. "email marketing strategy" does NOT open the mailbox', () => {
  /*
   * "email" modifies "marketing". A keyword score would have opened a mailbox
   * to answer a question about advertising.
   */
  const p = plan('email marketing strategy');
  assert.equal(chose(p, 'migra.email'), false, 'a topic word opened the mailbox');
  const why = p.rejected.find((r) => r.capabilityId === 'migra.email');
  assert.equal(why?.reason, 'noun-is-modifier');
  assert.equal(why?.evidence, 'email', 'the plan does not record which word it considered');
});

test('🚨 6. "Where is the email validator implemented?" stays a repository question', () => {
  const p = plan('Where is the email validator implemented?');
  assert.equal(chose(p, 'migra.email'), false, 'a code question opened the mailbox');
  assert.equal(p.repoPlanning, true, 'the repository question lost its repository planning');
});

test('🚨 "rename the email field in this file" is a code change, not a mailbox read', () => {
  const p = plan('rename the email field in this file');
  assert.equal(chose(p, 'migra.email'), false);
  assert.equal(p.repoPlanning, true);
});

test('a bare mention with no action is a topic, not a request', () => {
  // "My inbox is a disaster, anyway" — the defect this project already fixed
  // once, restated at the selection layer.
  const p = plan('my inbox is a disaster, anyway');
  assert.equal(chose(p, 'migra.email'), false);
});

/* ------------------------------------------------------------------ *
 * 🚨 4. Mixed requests select both
 * ------------------------------------------------------------------ */

test('🚨 4. "Compare that email with telemetry.ts" selects the mailbox AND keeps repo planning', () => {
  const p = plan('Compare that email with telemetry.ts');
  assert.equal(chose(p, 'migra.email'), true, 'the mailbox was not selected for a mixed request');
  assert.equal(p.repoPlanning, true, 'the repository half of a mixed request was dropped');
});

test('a path in the prompt keeps repository planning even alongside a mailbox request', () => {
  const p = plan('Compare that email with src/engine/email/telemetry.ts');
  assert.equal(chose(p, 'migra.email'), true);
  assert.equal(p.repoPlanning, true);
});

/* ------------------------------------------------------------------ *
 * 🚨 7 + 8. Fail closed
 * ------------------------------------------------------------------ */

test('🚨 7. an UNIDENTIFIED request selects nothing, and says why', () => {
  /*
   * Identity is checked before availability so an unidentified caller does not
   * learn whether a mailbox exists.
   */
  const p = plan('Find the email containing MIGRA_EMAIL_SENTINEL_0909', { identified: false });
  assert.equal(p.selected.length, 0, 'an unidentified request selected a capability');
  assert.equal(p.rejected.find((r) => r.capabilityId === 'migra.email')?.reason, 'capability-unavailable');
});

test('🚨 8. an UNAVAILABLE capability is rejected explicitly, not silently ignored', () => {
  /*
   * "Not asked for" and "asked for but not connected" are different answers to
   * a user. A plan that dropped the second would produce a reply about a
   * mailbox that never mentions it is disconnected.
   */
  const p = plan('Find the email containing X', {
    caps: [{ ...MAIL, available: false }, SEARCH],
  });
  assert.equal(p.selected.length, 0);
  const why = p.rejected.find((r) => r.capabilityId === 'migra.email');
  assert.equal(why?.reason, 'capability-unavailable');
  assert.equal(why?.evidence, 'email');
});

/* ------------------------------------------------------------------ *
 * 🚨 Capability-generic
 * ------------------------------------------------------------------ */

test('🚨 nothing in the selector names a capability', async () => {
  /*
   * The nouns come from the registry, so a capability that arrives later is
   * selectable without chat learning anything — and chat cannot develop
   * opinions about one capability it lacks about the others.
   */
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const source = readFileSync(join(process.cwd(), 'src/engine/models/capabilitySelection.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  for (const named of ['migra.email', 'migra.search', 'gmail', 'mailbox', 'inbox']) {
    assert.ok(!code.includes(named), `the selector hardcodes a capability: ${named}`);
  }
});

test('a capability registered LATER is selectable with no change to the selector', () => {
  // The proof that it is generic: a capability the selector has never seen.
  const calendar = { id: 'migra.calendar', nouns: ['meeting', 'calendar'], available: true };
  const p = plan('find the meeting about budget', { caps: [MAIL, calendar] });
  assert.equal(chose(p, 'migra.calendar'), true, 'a new capability was not selectable');
  assert.equal(chose(p, 'migra.email'), false);
});

test('the plan records a REASON for every candidate, chosen or not', () => {
  // A plan that recorded only its winners could not answer "why not".
  const p = plan('Compare that email with telemetry.ts');
  const accounted = new Set([
    ...p.selected.map((s) => s.capabilityId),
    ...p.rejected.map((r) => r.capabilityId),
  ]);
  assert.deepEqual([...accounted].sort(), ['migra.email', 'migra.search']);
});
