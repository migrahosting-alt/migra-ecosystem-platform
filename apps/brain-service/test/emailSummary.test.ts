/**
 * THE GROUNDED SUMMARY.
 *
 * The property with teeth is negative: a partial summary must say so, and it
 * must say so whatever the model wrote. Asking a model to disclose is an
 * instruction that fails silently on the answer nobody reads — so the sentence
 * is attached rather than requested, and these tests hold that shape.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderSummary,
  summaryContextFrom,
  summaryInstructions,
  summaryMaterial,
} from '../src/engine/email/emailSummary.js';
import { SNIPPET_LIMITATION, type EmailMessageEvidence, type EmailSummaryEvidence } from '../src/engine/email/evidence.js';

const message = (over: Partial<EmailMessageEvidence> = {}): EmailMessageEvidence => ({
  id: 'msg_1',
  providerMessageId: 'pm-1',
  providerThreadId: 'pt-1',
  from: 'billing@hetzner.com',
  subject: 'Invoice 2026-09',
  sentAt: '2026-09-01T10:00:00Z',
  text: 'Your invoice for September is attached.',
  completeness: 'complete',
  ...over,
} as EmailMessageEvidence);

const summary = (ids: string[], complete = true): EmailSummaryEvidence => ({
  id: 'sum_1',
  sourceMessageIds: ids,
  complete,
  limitation: complete ? '' : SNIPPET_LIMITATION,
});

/* ------------------------------------------------------------------ *
 * 🚨 The disclosure
 * ------------------------------------------------------------------ */

test('🚨 a partial summary carries the disclosure NO MATTER what the model wrote', () => {
  /*
   * The model is never asked to disclose. An instruction to a model fails the
   * way every such instruction fails: silently, on the occasion nobody was
   * watching, in an answer that reads perfectly.
   */
  const built = summaryContextFrom({
    evidence: summary(['msg_1'], false),
    available: [message({ completeness: 'snippet' })],
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;

  for (const prose of [
    'Hetzner sent an invoice.',
    '',
    'A confident answer that mentions nothing about previews at all.',
  ]) {
    const rendered = renderSummary(prose, built.context);
    assert.ok(rendered.includes(SNIPPET_LIMITATION), `a partial summary omitted its limitation: "${prose}"`);
  }
});

test('a complete summary does NOT carry a limitation it does not have', () => {
  // A caveat that is not true is its own inaccuracy, and it teaches people to
  // ignore the caveat when it is true.
  const built = summaryContextFrom({ evidence: summary(['msg_1']), available: [message()] });
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal(renderSummary('Hetzner sent an invoice.', built.context), 'Hetzner sent an invoice.');
  }
});

test('🚨 the disclosure is not doubled when the model already said it', () => {
  // The same caveat twice reads as a fault in the product.
  const built = summaryContextFrom({
    evidence: summary(['msg_1'], false),
    available: [message({ completeness: 'snippet' })],
  });
  assert.equal(built.ok, true);
  if (built.ok) {
    const prose = `Hetzner sent an invoice. ${SNIPPET_LIMITATION}`;
    const rendered = renderSummary(prose, built.context);
    assert.equal(rendered.split(SNIPPET_LIMITATION).length - 1, 1, 'the limitation appeared twice');
  }
});

test('🚨 ONE snippet among complete messages makes the whole summary partial', () => {
  /*
   * A reader cannot tell which sentence came from which message, so "mostly
   * complete" is not a claim that can be made honestly at this granularity.
   */
  const built = summaryContextFrom({
    evidence: summary(['msg_1', 'msg_2']),
    available: [message(), message({ id: 'msg_2', completeness: 'snippet' })],
  });
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal(built.context.complete, false);
    assert.ok(renderSummary('Two messages.', built.context).includes(SNIPPET_LIMITATION));
  }
});

test('🚨 completeness is RE-DERIVED from the sources, not trusted from the flag', () => {
  /*
   * The evidence's flag is a claim about the sources. If the two ever disagree
   * the sources are the ground truth — a flag saying "complete" over a snippet
   * would otherwise suppress the disclosure.
   */
  const built = summaryContextFrom({
    evidence: summary(['msg_1'], true), // claims complete
    available: [message({ completeness: 'snippet' })], // but it is not
  });
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal(built.context.complete, false, 'a lying flag suppressed the disclosure');
    assert.ok(renderSummary('x', built.context).includes(SNIPPET_LIMITATION));
  }
});

/* ------------------------------------------------------------------ *
 * 🚨 What the model may read
 * ------------------------------------------------------------------ */

test('🚨 the context carries ONLY statable facts, never the message object', () => {
  /*
   * A message carries provider ids, labels and raw headers that evidence does
   * not license. Handing the whole object to a model invites it to state any of
   * them, and a summary naming a provider id has left what was retrieved.
   */
  const built = summaryContextFrom({ evidence: summary(['msg_1']), available: [message()] });
  assert.equal(built.ok, true);
  if (!built.ok) return;

  const serialised = JSON.stringify(built.context);
  assert.ok(!serialised.includes('pm-1'), 'a provider message id reached the model context');
  assert.ok(!serialised.includes('pt-1'), 'a provider thread id reached the model context');

  const keys = Object.keys(built.context.sources[0]!).sort();
  assert.deepEqual(keys, ['evidenceId', 'from', 'sentAt', 'subject', 'text', 'textIsComplete']);
});

test('🚨 a citation that is not available REFUSES rather than being dropped', () => {
  /*
   * Silently omitting it would produce a summary that claims fewer sources than
   * it was asked for, with nothing saying so; describing it would be a message
   * we never saw.
   */
  const built = summaryContextFrom({ evidence: summary(['msg_1', 'msg_missing']), available: [message()] });
  assert.equal(built.ok, false);
  if (!built.ok) assert.equal(built.refusal.kind, 'missing_source');
});

test('an empty source set refuses instead of summarising nothing', () => {
  const built = summaryContextFrom({ evidence: summary([]), available: [message()] });
  assert.equal(built.ok, false);
  if (!built.ok) assert.equal(built.refusal.kind, 'no_sources');
});

/* ------------------------------------------------------------------ *
 * The material
 * ------------------------------------------------------------------ */

test('🚨 a preview is labelled as one, per message', () => {
  /*
   * The aggregate flag cannot express that one of four messages was truncated.
   * The model needs to see which.
   */
  const built = summaryContextFrom({
    evidence: summary(['msg_1', 'msg_2']),
    available: [message(), message({ id: 'msg_2', completeness: 'snippet', text: 'Your invoice for…' })],
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;

  const material = summaryMaterial(built.context);
  assert.match(material, /Body \(complete\):/);
  assert.match(material, /PREVIEW ONLY/);
  assert.match(material, /message 1 of 2/);
  assert.match(material, /message 2 of 2/);
});

test('the instructions constrain rather than encourage', () => {
  // "Be accurate" and "state only what appears below" produce very different
  // failures.
  const built = summaryContextFrom({ evidence: summary(['msg_1']), available: [message()] });
  assert.equal(built.ok, true);
  if (built.ok) {
    const instructions = summaryInstructions(built.context);
    assert.match(instructions, /only what appears/i);
    assert.match(instructions, /do not infer/i);
  }
});

test('partial material tells the model not to describe what a preview lacks', () => {
  const built = summaryContextFrom({
    evidence: summary(['msg_1'], false),
    available: [message({ completeness: 'snippet' })],
  });
  assert.equal(built.ok, true);
  if (built.ok) assert.match(summaryInstructions(built.context), /previews rather than full text/i);
});

/* ------------------------------------------------------------------ *
 * 🚨 Scope is inherited, structurally
 * ------------------------------------------------------------------ */

test('🚨 this module cannot reach a mailbox at all', async () => {
  /*
   * A summary must not be able to fetch anything: its sources come from a
   * per-caller read that already happened. Asserted against the SOURCE because
   * the guarantee is the absence of a capability, and absence has no runtime
   * behaviour to observe.
   */
  /*
   * Resolved from the PACKAGE ROOT, not from import.meta.url. The suite runs
   * compiled from `dist/test`, where a path relative to this file points at a
   * `dist/src` that does not exist — the same shape as the glob that once left
   * a whole test file out of the suite while it passed when run directly.
   */
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const source = readFileSync(join(process.cwd(), 'src/engine/email/emailSummary.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  for (const forbidden of ['mailProviderFor', 'resolveForCaller', 'executeEmail', 'MailConnectionStore', 'principal']) {
    assert.ok(!code.includes(forbidden), `the summariser can reach a mailbox: ${forbidden}`);
  }
});
