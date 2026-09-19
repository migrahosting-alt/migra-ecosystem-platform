// The Brain must not talk about mutation on a run that proposed none.
//
// A completed read-only inspection used to close with "workspace mutation remains
// approval-gated" — a gate nothing was ever queued at. Observed live: an INSPECT
// task in the TAP workspace reported `verified` with that sentence, having
// proposed nothing at all. It was one half of the defect that rendered a
// read-only task as an approval card; the client stopped drawing the controls,
// and this sentence was what remained.
//
// The discriminator is the OPERATIONS, matching the client exactly, so the two
// surfaces cannot drift into disagreeing about whether a change exists.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  completionCheckpointText,
  hasMutationProposal,
  MUTATION_COMPLETION_CHECKPOINT,
  READ_ONLY_COMPLETION_CHECKPOINT,
} from '../src/engine/engineer/engineerCompletionNarrative.js';

/** Any wording that implies something is waiting to be applied. */
const MUTATION_LANGUAGE = /mutation|approval-gated|approve|apply/i;

const proposal = (operations: unknown[]) => ({
  proposal: {
    proposalHash: 'h'.repeat(64),
    approvalState: 'pending' as const,
    operations,
    expectedVerification: [],
  },
});

// ── read-only runs ───────────────────────────────────────────────────────────

test('INSPECT with no proposal: no mutation or approval wording', () => {
  const text = completionCheckpointText({});

  assert.equal(text, READ_ONLY_COMPLETION_CHECKPOINT);
  assert.doesNotMatch(text, MUTATION_LANGUAGE);
});

test('READ/ANALYZE with no proposal: no mutation or approval wording', () => {
  // `undefined` is the shape a task carries before anything is proposed.
  for (const task of [undefined, {}, { proposal: undefined }]) {
    const text = completionCheckpointText(task);
    assert.doesNotMatch(text, MUTATION_LANGUAGE, JSON.stringify(task));
  }
});

test('PLAN with no file operations: no mutation or approval wording', () => {
  // A plan is not a change. Planning to edit something is not proposing an edit.
  const text = completionCheckpointText(proposal([]));

  assert.equal(text, READ_ONLY_COMPLETION_CHECKPOINT);
  assert.doesNotMatch(text, MUTATION_LANGUAGE);
});

test('a WITHDRAWN or empty proposal leaves no stale mutation wording', () => {
  // The proposal object survives; its operations do not. The wording must follow
  // the operations, or a retracted changeset keeps asking to be approved.
  const withdrawn = proposal([]);
  assert.equal(hasMutationProposal(withdrawn), false);
  assert.doesNotMatch(completionCheckpointText(withdrawn), MUTATION_LANGUAGE);

  // Also guards a malformed payload: not an array is not an operation list.
  assert.equal(
    hasMutationProposal({ proposal: { operations: undefined } }),
    false,
  );
  assert.equal(
    hasMutationProposal({ proposal: { operations: 'edit a.ts' as never } }),
    false,
  );
});

// ── runs that really did propose something ──────────────────────────────────

test('a proposal with a real write/edit/delete DOES carry approval wording', () => {
  for (const operation of ['edit', 'create', 'delete', 'mkdir']) {
    const task = proposal([{ path: 'src/a.ts', operation }]);

    assert.equal(hasMutationProposal(task), true, operation);
    assert.equal(completionCheckpointText(task), MUTATION_COMPLETION_CHECKPOINT, operation);
    assert.match(completionCheckpointText(task), MUTATION_LANGUAGE, operation);
  }
});

test('several operations still read as one approval-gated change', () => {
  const task = proposal([
    { path: 'src/a.ts', operation: 'edit' },
    { path: 'src/b.ts', operation: 'create' },
  ]);

  assert.equal(completionCheckpointText(task), MUTATION_COMPLETION_CHECKPOINT);
});

// ── the two surfaces must agree ─────────────────────────────────────────────

test('the discriminator is OPERATIONS, never the stage', () => {
  // The client card learned this the hard way: a task can report
  // awaiting_approval while carrying an empty operation list, and that must not
  // raise approval language on either surface.
  const claimsApprovalButHasNothing = {
    stage: 'awaiting_approval',
    ...proposal([]),
  };

  assert.equal(hasMutationProposal(claimsApprovalButHasNothing), false);
  assert.doesNotMatch(
    completionCheckpointText(claimsApprovalButHasNothing),
    MUTATION_LANGUAGE,
  );
});
