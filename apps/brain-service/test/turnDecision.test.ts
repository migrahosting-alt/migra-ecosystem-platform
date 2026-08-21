import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decideTurn,
  parseDeclaredKind,
  type TurnDecisionInput,
} from '../src/engine/turnDecision.js';

/** A workspace that exists, with read granted and mutation NOT granted. */
const base = (over: Partial<TurnDecisionInput> = {}): TurnDecisionInput => ({
  intent: 'DISCUSS',
  deferredObserved: true,
  workspaceExists: true,
  readCapabilityGranted: true,
  governanceConsumed: false,
  mutationCapabilityGranted: false,
  ...over,
});

// ── the acceptance examples ──────────────────────────────────────────────────

test('"report what is in this repo" — WORKSPACE_FACT, inspect', () => {
  const d = decideTurn(
    base({ intent: 'INSPECT', declaration: { kind: 'WORKSPACE_FACT', subject: 'repository contents' } }),
  );
  assert.equal(d.missingInformationKind, 'WORKSPACE_FACT');
  assert.equal(d.disposition, 'CONTINUE_TO_INSPECT');
  // The first attempt at this fix broke exactly this turn, because it named no path.
  assert.equal(d.toolAuthority, 'READ_ONLY');
});

test('"where is the engineer loop?" — WORKSPACE_FACT, search/read', () => {
  const d = decideTurn(
    base({ intent: 'INSPECT', declaration: { kind: 'WORKSPACE_FACT', subject: 'engineer loop' } }),
  );
  assert.equal(d.disposition, 'CONTINUE_TO_INSPECT');
  assert.equal(d.toolAuthority, 'READ_ONLY');
});

test('RECORD #1: "what kind of website?" — USER_PREFERENCE, ask and stop', () => {
  const d = decideTurn(
    base({
      intent: 'BUILD',
      declaration: { kind: 'USER_PREFERENCE', subject: 'desired site type and framework' },
    }),
  );
  assert.equal(d.missingInformationKind, 'USER_PREFERENCE');
  assert.equal(d.disposition, 'NEEDS_USER_INPUT');
  assert.equal(d.toolAuthority, 'NONE');
});

test('BUILD intent does NOT override a user-supplied gap', () => {
  // "build me a website" + "what kind?" is an incomplete REQUIREMENT, not a failure to
  // act. This is the precise conflation that produced Record #1.
  const d = decideTurn(
    base({
      intent: 'BUILD',
      declaration: { kind: 'USER_PREFERENCE' },
      governanceConsumed: true,
      mutationCapabilityGranted: true,
    }),
  );
  assert.equal(d.disposition, 'NEEDS_USER_INPUT');
  assert.equal(d.toolAuthority, 'NONE');
});

test('the "language" question resolves by DECLARED KIND, not by the word', () => {
  // Same noun, opposite classification — which is why no keyword shortcut can work.
  const preference = decideTurn(
    base({ intent: 'BUILD', declaration: { kind: 'USER_PREFERENCE', subject: 'language to use' } }),
  );
  const fact = decideTurn(
    base({ intent: 'INSPECT', declaration: { kind: 'WORKSPACE_FACT', subject: 'language this repo uses' } }),
  );

  assert.equal(preference.disposition, 'NEEDS_USER_INPUT');
  assert.equal(fact.disposition, 'CONTINUE_TO_INSPECT');
});

// ── the authority ladder ─────────────────────────────────────────────────────

test('a WORKSPACE_FACT never buys mutation, even on BUILD intent', () => {
  const d = decideTurn(
    base({
      intent: 'BUILD',
      declaration: { kind: 'WORKSPACE_FACT' },
      governanceConsumed: true,
      mutationCapabilityGranted: true,
    }),
  );
  // The containment that matters: a MISCLASSIFICATION of Record #1 as a workspace fact
  // would cost a bounded search, never fs.proposeChangeset.
  assert.equal(d.toolAuthority, 'READ_ONLY');
  assert.notEqual(d.toolAuthority, 'MUTATION');
});

test('mutation requires build intent AND governance consumed AND a grant', () => {
  const granted = decideTurn(
    base({
      intent: 'BUILD',
      deferredObserved: false,
      declaration: { kind: 'NONE' },
      governanceConsumed: true,
      mutationCapabilityGranted: true,
    }),
  );
  assert.equal(granted.toolAuthority, 'MUTATION');
  assert.equal(granted.disposition, 'CONTINUE_TO_ACT');

  for (const missing of [
    { governanceConsumed: false, mutationCapabilityGranted: true },
    { governanceConsumed: true, mutationCapabilityGranted: false },
    { governanceConsumed: false, mutationCapabilityGranted: false },
  ]) {
    const d = decideTurn(
      base({ intent: 'BUILD', deferredObserved: false, declaration: { kind: 'NONE' }, ...missing }),
    );
    assert.notEqual(d.toolAuthority, 'MUTATION', `mutation granted with ${JSON.stringify(missing)}`);
  }
});

test('DISCUSS intent never reaches mutation however much is granted', () => {
  const d = decideTurn(
    base({
      intent: 'DISCUSS',
      deferredObserved: false,
      declaration: { kind: 'NONE' },
      governanceConsumed: true,
      mutationCapabilityGranted: true,
    }),
  );
  assert.equal(d.toolAuthority, 'NONE');
  assert.equal(d.disposition, 'TERMINATE');
});

// ── the declaration is evidence, not authorization ───────────────────────────

test('an unverifiable WORKSPACE_FACT claim is overridden and fails closed', () => {
  const d = decideTurn(
    base({ intent: 'INSPECT', declaration: { kind: 'WORKSPACE_FACT' }, workspaceExists: false }),
  );
  assert.equal(d.missingInformationKind, 'UNKNOWN');
  assert.equal(d.disposition, 'NEEDS_USER_INPUT');
  assert.equal(d.toolAuthority, 'NONE');
  assert.equal(d.declarationOverridden, true);
  assert.ok(d.verification.some((v) => v.check === 'workspace exists' && !v.passed));
});

test('a WORKSPACE_FACT claim without read capability is refused', () => {
  const d = decideTurn(
    base({ intent: 'INSPECT', declaration: { kind: 'WORKSPACE_FACT' }, readCapabilityGranted: false }),
  );
  assert.equal(d.toolAuthority, 'NONE');
  assert.equal(d.declarationOverridden, true);
});

test('a deferral with NO declaration fails closed to the user, never to execution', () => {
  const d = decideTurn(base({ intent: 'BUILD', declaration: undefined }));
  assert.equal(d.missingInformationKind, 'UNKNOWN');
  assert.equal(d.disposition, 'NEEDS_USER_INPUT');
  assert.equal(d.toolAuthority, 'NONE');
});

test('a malformed kind is UNKNOWN, never the nearest guess', () => {
  for (const junk of ['workspace', 'WORKSPACE-FACT!', '', null, undefined, 42, 'USER']) {
    assert.equal(parseDeclaredKind(junk), 'UNKNOWN', `coerced ${JSON.stringify(junk)}`);
  }
  assert.equal(parseDeclaredKind('workspace_fact'), 'WORKSPACE_FACT');
});

test('no path through the decision grants MUTATION while governance is unconsumed', () => {
  const intents = ['DISCUSS', 'INSPECT', 'BUILD', 'MODIFY', 'UNKNOWN'] as const;
  const kinds = ['WORKSPACE_FACT', 'USER_PREFERENCE', 'EXTERNAL_FACT', 'NONE', 'UNKNOWN', 'garbage'];

  for (const intent of intents) {
    for (const kind of kinds) {
      for (const deferredObserved of [true, false]) {
        const d = decideTurn(
          base({
            intent,
            deferredObserved,
            declaration: { kind },
            governanceConsumed: false,
            mutationCapabilityGranted: true,
          }),
        );
        assert.notEqual(
          d.toolAuthority,
          'MUTATION',
          `mutation reachable with governance unconsumed: ${intent}/${kind}/${deferredObserved}`,
        );
      }
    }
  }
});
