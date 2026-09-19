// Controller-owned task obligations.
//
// Every fixture here is taken from a real run. The prompt is the one the owner
// actually sent, and the tool sequence is the one the run actually executed,
// read back out of its durable checkpoint. The run answered "The inspection is
// complete" and named three files it had never opened; these assert that the
// controller, counting independently, would have refused that final.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deriveTaskObligations,
  observeTaskObligations,
  unresolvedTaskObligations,
  evidenceTypeOf,
  renderTaskObligationDirective,
} from '../src/engine/engineer/engineerTaskObligations.js';

const OWNER_PROMPT = [
  'Inspect this repository read-only.',
  '',
  'Read package.json, inspect the src tree, read the application entrypoint,',
  'inspect one API implementation, one server-side implementation, and one test implementation.',
  '',
  'Do not modify anything.',
  '',
  'Do not give a final answer until all six inspection requirements are supported',
  'by actual file-content evidence.',
].join('\n');

/** A successful file.read, shaped as the tool actually returns it. */
const readOk = (path: string, content = 'export const x = 1;\n') => ({
  toolId: 'file.read',
  semantics: ['workspace.file_content'] as const,
  input: { path },
  result: { path, content },
});

const listOk = (dir: string) => ({
  toolId: 'workspace.list',
  semantics: ['workspace.directory_listing'] as const,
  input: { path: dir },
  result: { dir, entries: [{ name: 'a.ts' }] },
});

const findOk = (query: string, matches: string[]) => ({
  toolId: 'workspace.find',
  semantics: ['workspace.path_discovery'] as const,
  input: { query },
  result: { matches },
});

function observe(
  state: ReturnType<typeof deriveTaskObligations>,
  obs: { toolId: string; semantics: readonly string[]; input: unknown; result: unknown },
): number {
  return observeTaskObligations(
    state,
    obs.toolId,
    obs.semantics as never,
    obs.input,
    obs.result,
  );
}

const idsOf = (state: ReturnType<typeof deriveTaskObligations>) =>
  state.obligations.map((o) => o.id).sort();

// ── derivation ───────────────────────────────────────────────────────────────

test('the owner prompt derives one obligation per stated requirement', () => {
  const state = deriveTaskObligations(OWNER_PROMPT);

  assert.deepEqual(idsOf(state), [
    'task.api_implementation',
    'task.entrypoint',
    'task.manifest',
    'task.server_implementation',
    'task.source_tree',
    'task.test_implementation',
  ]);
  assert.ok(
    state.obligations.every((o) => o.status === 'PENDING'),
    'everything starts unproven — the model cannot begin with credit',
  );
});

test('an ordinary question derives no obligations at all', () => {
  // The contract must not attach itself to every turn, or "hi" becomes unanswerable.
  for (const text of ['hi', 'where is the login form?', 'what does this project do?']) {
    assert.deepEqual(deriveTaskObligations(text).obligations, [], text);
  }
});

// ── the defect this module exists for ────────────────────────────────────────

test('THE REAL RUN: the exact tool sequence leaves server and test UNSATISFIED', () => {
  // Read back from checkpoint corr_mu7men3j8q9b6c. This run told the owner
  // "The inspection is complete."
  const state = deriveTaskObligations(OWNER_PROMPT);

  observe(state, readOk('package.json', '{"name":"tap"}'));
  observe(state, listOk('src'));
  observe(state, readOk('src/app/page.tsx'));
  observe(state, findOk('*.ts', ['src/server/database.ts', 'src/server/ledger.ts']));
  observe(state, readOk('next.config.ts'));
  observe(state, readOk('src/app/api/[...path]/route.ts'));
  observe(state, findOk('index.ts', ['src/types/index.ts']));
  observe(state, readOk('src/types/index.ts'));

  const unresolved = unresolvedTaskObligations(state).map((o) => o.id).sort();

  assert.deepEqual(
    unresolved,
    ['task.server_implementation', 'task.test_implementation'],
    'the two requirements it answered from filenames must remain unproven',
  );
});

test('workspace.find can NEVER satisfy a file-content obligation', () => {
  // The heart of it. The run located src/server/database.ts and then described
  // it. Finding a path is not reading it.
  const state = deriveTaskObligations(OWNER_PROMPT);

  const advanced = observe(
    state,
    findOk('*.ts', ['src/server/database.ts', 'src/server/ledger.ts', 'tests/payments.test.ts']),
  );

  assert.equal(advanced, 0);
  assert.equal(
    state.obligations.find((o) => o.id === 'task.server_implementation')?.status,
    'PENDING',
  );
  assert.equal(
    state.obligations.find((o) => o.id === 'task.test_implementation')?.status,
    'PENDING',
  );
});

test('reading the files it only named DOES satisfy them', () => {
  // The positive control. If this failed, the obligations would be unsatisfiable
  // and the gate would just deadlock every run.
  const state = deriveTaskObligations(OWNER_PROMPT);

  observe(state, readOk('src/server/database.ts'));
  observe(state, readOk('tests/payments.test.ts'));

  assert.equal(
    state.obligations.find((o) => o.id === 'task.server_implementation')?.status,
    'SATISFIED',
  );
  assert.equal(
    state.obligations.find((o) => o.id === 'task.test_implementation')?.status,
    'SATISFIED',
  );
});

test('all six satisfied leaves nothing unresolved', () => {
  const state = deriveTaskObligations(OWNER_PROMPT);

  observe(state, readOk('package.json', '{"name":"tap"}'));
  observe(state, listOk('src'));
  observe(state, readOk('src/app/page.tsx'));
  observe(state, readOk('src/app/api/[...path]/route.ts'));
  observe(state, readOk('src/server/ledger.ts'));
  observe(state, readOk('tests/browser/flow.spec.ts'));

  assert.deepEqual(unresolvedTaskObligations(state), []);
});

// ── a successful dispatch is not a successful inspection ─────────────────────

test('an empty or errored read proves nothing', () => {
  const state = deriveTaskObligations(OWNER_PROMPT);

  observe(state, readOk('src/server/ledger.ts', '   '));
  observe(state, {
    toolId: 'file.read',
    semantics: ['workspace.file_content'],
    input: { path: 'src/server/database.ts' },
    result: { ok: false, error: 'ENOENT' },
  });

  assert.equal(
    state.obligations.find((o) => o.id === 'task.server_implementation')?.status,
    'PENDING',
  );
});

test('content returned for a DIFFERENT path than requested proves nothing', () => {
  // Guards against a tool answering a near-miss path and the ledger crediting it.
  const state = deriveTaskObligations(OWNER_PROMPT);

  observe(state, {
    toolId: 'file.read',
    semantics: ['workspace.file_content'],
    input: { path: 'src/server/ledger.ts' },
    result: { path: 'src/server/README.md', content: '# not the implementation' },
  });

  assert.equal(
    state.obligations.find((o) => o.id === 'task.server_implementation')?.status,
    'PENDING',
  );
});

test('a config file is not an entrypoint', () => {
  // This run read next.config.ts and presented it under "Application Entrypoint".
  const state = deriveTaskObligations(OWNER_PROMPT);

  observe(state, readOk('next.config.ts'));
  assert.equal(
    state.obligations.find((o) => o.id === 'task.entrypoint')?.status,
    'PENDING',
  );

  observe(state, readOk('src/app/page.tsx'));
  assert.equal(
    state.obligations.find((o) => o.id === 'task.entrypoint')?.status,
    'SATISFIED',
  );
});

test('repeating an accepted read neither double-counts nor un-satisfies', () => {
  // Deduplication is a working feature and must not be disturbed by this ledger.
  const state = deriveTaskObligations(OWNER_PROMPT);

  assert.equal(observe(state, readOk('src/server/ledger.ts')), 1);
  assert.equal(observe(state, readOk('src/server/ledger.ts')), 0, 'no double credit');

  const obligation = state.obligations.find((o) => o.id === 'task.server_implementation')!;
  assert.equal(obligation.status, 'SATISFIED');
  assert.equal(obligation.acceptedEvidenceRefs.length, 1);
});

// ── evidence vocabulary ──────────────────────────────────────────────────────

test('evidence types map from the tool registry vocabulary, not from tool names', () => {
  assert.equal(evidenceTypeOf(['workspace.file_content']), 'file_content');
  assert.equal(evidenceTypeOf(['workspace.directory_listing']), 'directory_listing');
  assert.equal(evidenceTypeOf(['workspace.content_search']), 'content_search');
  assert.equal(evidenceTypeOf(['workspace.path_discovery']), 'path_discovery');
  assert.equal(evidenceTypeOf(['vcs.state']), 'repo_state');
  assert.equal(evidenceTypeOf([]), undefined);
  assert.equal(evidenceTypeOf(undefined), undefined);
});

test('the refusal directive names the obligation AND the evidence type that discharges it', () => {
  const state = deriveTaskObligations(OWNER_PROMPT);
  const directive = renderTaskObligationDirective(unresolvedTaskObligations(state));

  assert.match(directive, /COMPLETION REFUSED BY THE CONTROLLER/);
  assert.match(directive, /task\.server_implementation .*requires file_content/);
  assert.match(directive, /Finding a path is not reading it/);
});
