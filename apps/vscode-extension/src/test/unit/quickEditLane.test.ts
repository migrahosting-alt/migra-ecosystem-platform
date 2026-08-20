// Acceptance for the lightweight edit lane, extension side.
//
// The engine's own guarantees — containment, staleness, atomic all-or-nothing apply and
// rollback — are proven against the real engine in brain-service. What is asserted here is
// what the LANE adds and must not lose: bounds enforced before a user is asked to approve,
// fail-closed on an unreachable Brain, refusals reported as refusals, and no filesystem
// write anywhere in the extension.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  QUICK_EDIT_MAX_FILES,
  QUICK_EDIT_MAX_TOTAL_BYTES,
  boundsRefusal,
  fileOpsOf,
  proposedBytes,
  runQuickEditFlow,
  summarize,
  type QuickEditOp,
  type QuickEditProposal,
  type QuickEditUi,
} from '../../services/quickEditFlow.js';

interface Captured {
  refusals: string[];
  confirmed: Array<{ summary: string; ops: QuickEditOp[] }>;
  applied: string[][];
}

function harness(confirm: boolean): { ui: QuickEditUi; captured: Captured } {
  const captured: Captured = { refusals: [], confirmed: [], applied: [] };
  return {
    captured,
    ui: {
      confirm: async (summary, ops) => {
        captured.confirmed.push({ summary, ops });
        return confirm;
      },
      showRefusal: async (reason) => {
        captured.refusals.push(reason);
      },
      showApplied: async (files) => {
        captured.applied.push(files);
      },
    },
  };
}

const proposal = (ops: QuickEditOp[]): QuickEditProposal => ({ proposalHash: 'h'.repeat(64), ops });
const edit = (p: string, after: string): QuickEditOp => ({ kind: 'modify', path: p, before: 'old', after });

test('applies a bounded change and reports the files touched', async () => {
  const { ui, captured } = harness(true);
  const outcome = await runQuickEditFlow({
    instruction: 'bump the timeout',
    rootPath: '/w',
    ui,
    engine: {
      propose: async () => proposal([edit('src/a.ts', 'new')]),
      apply: async () => true,
    },
  });
  assert.deepEqual(outcome, { status: 'applied', files: ['src/a.ts'] });
  assert.equal(captured.confirmed.length, 1, 'the user must see the diff before it applies');
  assert.deepEqual(captured.applied[0], ['src/a.ts']);
});

test('a multi-file change within the bound is allowed', async () => {
  const { ui } = harness(true);
  const ops = [edit('src/a.ts', 'a'), edit('src/b.ts', 'b'), edit('src/c.ts', 'c')];
  assert.equal(boundsRefusal(ops), null);
  const outcome = await runQuickEditFlow({
    instruction: 'rename across three files',
    rootPath: '/w',
    ui,
    engine: { propose: async () => proposal(ops), apply: async () => true },
  });
  assert.equal(outcome.status, 'applied');
});

test('BOUND: too many files is refused BEFORE the user is asked', async () => {
  const { ui, captured } = harness(true);
  const many = Array.from({ length: QUICK_EDIT_MAX_FILES + 1 }, (_, i) => edit(`src/f${i}.ts`, 'x'));
  let applyCalled = false;
  const outcome = await runQuickEditFlow({
    instruction: 'big change',
    rootPath: '/w',
    ui,
    engine: {
      propose: async () => proposal(many),
      apply: async () => {
        applyCalled = true;
        return true;
      },
    },
  });
  assert.equal(outcome.status, 'refused');
  assert.equal(captured.confirmed.length, 0, 'never ask approval for something the lane will refuse');
  assert.equal(applyCalled, false);
  assert.match(captured.refusals[0]!, /governed coding run/);
});

test('BOUND: too many bytes is refused, and names the limit', async () => {
  const { ui, captured } = harness(true);
  const huge = [edit('src/big.ts', 'x'.repeat(QUICK_EDIT_MAX_TOTAL_BYTES + 1))];
  const outcome = await runQuickEditFlow({
    instruction: 'paste a large file',
    rootPath: '/w',
    ui,
    engine: { propose: async () => proposal(huge), apply: async () => true },
  });
  assert.equal(outcome.status, 'refused');
  assert.match(captured.refusals[0]!, /KiB/);
});

test('BOUND: a binary payload has no reviewable diff and is refused', () => {
  const refusal = boundsRefusal([edit('assets/logo.png', `PNG${String.fromCharCode(0)}data`)]);
  assert.ok(refusal !== null);
  assert.match(refusal, /looks binary/);
});

test('FAIL CLOSED: an unreachable Brain changes nothing and says so', async () => {
  const { ui, captured } = harness(true);
  const outcome = await runQuickEditFlow({
    instruction: 'bump the timeout',
    rootPath: '/w',
    ui,
    engine: {
      propose: async () => {
        throw new Error('local_runner_unavailable');
      },
      apply: async () => true,
    },
  });
  assert.equal(outcome.status, 'refused');
  assert.equal(captured.applied.length, 0);
  assert.match(captured.refusals[0]!, /nothing was changed/);
});

test('a refusal at APPLY time (stale content, containment, rollback) is reported as itself', async () => {
  const { ui, captured } = harness(true);
  const outcome = await runQuickEditFlow({
    instruction: 'bump the timeout',
    rootPath: '/w',
    ui,
    engine: {
      propose: async () => proposal([edit('src/a.ts', 'new')]),
      apply: async () => {
        throw new Error('source is stale');
      },
    },
  });
  assert.equal(outcome.status, 'refused');
  assert.match(captured.refusals[0]!, /was NOT applied/);
  assert.equal(captured.applied.length, 0);
});

test('an engine that declines to apply leaves the workspace reported as unchanged', async () => {
  const { ui, captured } = harness(true);
  const outcome = await runQuickEditFlow({
    instruction: 'bump the timeout',
    rootPath: '/w',
    ui,
    engine: { propose: async () => proposal([edit('src/a.ts', 'new')]), apply: async () => false },
  });
  assert.equal(outcome.status, 'refused');
  assert.match(captured.refusals[0]!, /workspace is unchanged/);
});

test('declining the diff applies nothing', async () => {
  const { ui, captured } = harness(false);
  let applyCalled = false;
  const outcome = await runQuickEditFlow({
    instruction: 'bump the timeout',
    rootPath: '/w',
    ui,
    engine: {
      propose: async () => proposal([edit('src/a.ts', 'new')]),
      apply: async () => {
        applyCalled = true;
        return true;
      },
    },
  });
  assert.deepEqual(outcome, { status: 'declined' });
  assert.equal(applyCalled, false);
  assert.equal(captured.applied.length, 0);
});

test('no proposal, no workspace and no instruction are each refused without applying', async () => {
  for (const [label, input] of [
    ['no proposal', { rootPath: '/w', instruction: 'x', ops: [] as QuickEditOp[] }],
    ['no workspace', { rootPath: undefined, instruction: 'x', ops: [edit('a', 'b')] }],
    ['no instruction', { rootPath: '/w', instruction: '   ', ops: [edit('a', 'b')] }],
  ] as const) {
    const { ui, captured } = harness(true);
    const outcome = await runQuickEditFlow({
      instruction: input.instruction,
      rootPath: input.rootPath,
      ui,
      engine: { propose: async () => proposal([...input.ops]), apply: async () => true },
    });
    assert.notEqual(outcome.status, 'applied', `${label} must not apply`);
    assert.equal(captured.applied.length, 0);
  }
});

test('mkdir is structural and does not consume the file budget', () => {
  const ops = [{ kind: 'mkdir', path: 'src/new' } as QuickEditOp, edit('src/new/a.ts', 'x')];
  assert.equal(fileOpsOf(ops).length, 1);
  assert.equal(proposedBytes(ops), 1);
  assert.equal(summarize(ops), 'src/new/a.ts');
});

test('THE EXTENSION NEVER WRITES WORKSPACE FILES in this lane', () => {
  for (const relative of ['services/quickEditFlow.ts', 'commands/quickEdit.ts']) {
    const source = readFileSync(path.resolve(__dirname, '../../../src', relative), 'utf8');
    for (const forbidden of [
      'node:fs',
      "from 'fs'",
      'writeFileSync',
      'workspace.fs.writeFile',
      'WorkspaceEdit',
      'applyEdit',
    ]) {
      assert.ok(!source.includes(forbidden), `${relative} must not reference "${forbidden}"`);
    }
  }
});

test('the lane documents why it is not a governed coding run', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/services/quickEditFlow.ts'), 'utf8');
  assert.match(source, /NO SECOND MUTATION PATH/);
  assert.match(source, /NO NEW APPROVAL/);
  assert.match(source, /Governed coding run \/ Agent Mode/);
});
