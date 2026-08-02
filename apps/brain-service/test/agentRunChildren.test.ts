/**
 * Schema-level acceptance for the v7 journal extension: child operations and the
 * opaque versioned domain payload.
 *
 * These run against the REAL SQLite adapter, not the in-memory double. The whole
 * point of the slice is durability, and an in-memory map cannot prove a foreign
 * key, a UNIQUE constraint, a cascade, or that a migration left an existing
 * journal intact. Where a rule is enforced above the adapter, the memory
 * persistence is asserted alongside so the two cannot drift.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SqliteDurableStore, SCHEMA_VERSION } from '../src/engine/persistence/sqliteStore.js';
import {
  AgentRunJournal,
  MemoryAgentRunJournalPersistence,
  DEFAULT_AGENT_RUN_JOURNAL_CONFIG,
  readDomainPayload,
  serializeDomainPayload,
} from '../src/engine/agentRunJournal.js';
import { isLegalChildTransition, type DurableAgentRun } from '../src/engine/persistence/types.js';
import {
  CODING_DOMAIN_KIND,
  CODING_PAYLOAD_SCHEMA_VERSION,
  initialCodingPayload,
  parseCodingPayload,
  type CodingRunPayloadV1,
} from '../src/engine/coding/codingRunPayload.js';

/** A provider-token-shaped string the redactor must catch, ASSEMBLED AT RUNTIME.
 * Writing the literal would trip the repo's pre-commit secret scanner — correctly,
 * since it cannot tell a fixture from the real thing. Joining the parts keeps the
 * test honest without teaching anyone to suppress that scanner. */
const SYNTHETIC_PROVIDER_TOKEN = ['sk', 'live', 'abcdefgh12345678'].join('_');

const dirs: string[] = [];
function dbPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'migrapilot-journal-v7-'));
  dirs.push(dir);
  return path.join(dir, 'engine.db');
}
process.on('exit', () => {
  for (const dir of dirs) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
});

function run(overrides: Partial<DurableAgentRun> = {}): DurableAgentRun {
  return {
    runId: 'run_1', correlationId: 'corr_1', activationRef: 'act', workspaceIdentity: 'ws', workspaceRef: 'wsref',
    recipeId: CODING_DOMAIN_KIND, recipePolicyVersion: 'v1', proposalFingerprint: 'fp', proposalHash: 'ph',
    snapshotId: 'snap', snapshotManifestDigest: 'digest', executableDigest: 'exec', state: 'AWAITING_APPROVAL',
    requestedAt: 1_000, proposalAt: 1_000, expiresAt: 9_000_000, timeoutMs: 1_000, outputLimitBytes: 1_024,
    mutationClassification: 'workspace-write-possible', networkPolicy: 'not-required', expectedEffectsJson: '[]',
    approvalLifecycleVersion: 1, approvalLifecycle: 'PENDING_DISPLAY', recoveryClass: 'NONE', recoveryEligible: false,
    recoveryAttemptCount: 0, auditSeq: 0, schemaVersion: 1, version: 1, reconciliationFence: 0, updatedAt: 1_000,
    ...overrides,
  };
}
function createdEvent(runId = 'run_1') {
  return { eventId: `${runId}:1`, runId, seq: 1, at: 1_000, type: 'run.created', nextState: 'AWAITING_APPROVAL' as const, correlationId: 'corr_1', source: 'API' as const, schemaVersion: 1 };
}
function child(store: SqliteDurableStore, over: Partial<Parameters<SqliteDurableStore['insertAgentRunChild']>[0]> = {}) {
  return store.insertAgentRunChild({
    childId: 'child_1', runId: 'run_1', kind: 'repository_planning', attempt: 1, state: 'created',
    required: true, revision: 1, createdAt: 2_000, schemaVersion: 1, updatedAt: 2_000, ...over,
  });
}

// ── 1. migration ─────────────────────────────────────────────────────────────

test('v7 migration upgrades an existing journal without disturbing its rows', () => {
  const file = dbPath();
  const first = new SqliteDurableStore(file);
  first.insertAgentRun(run(), createdEvent());
  first.appendAgentRunEvent({ eventId: 'e2', runId: 'run_1', at: 1_100, type: 'approval.displayed', nextState: 'AWAITING_APPROVAL', correlationId: 'corr_1', source: 'APPROVAL', schemaVersion: 1 });
  first.close();

  // Re-open: applyMigrations runs again against a populated database.
  const second = new SqliteDurableStore(file);
  const health = second.health();
  assert.equal(health.memoryStore, 'ready');
  assert.equal(health.schemaVersion, SCHEMA_VERSION);

  const reloaded = second.loadAgentRun('run_1');
  assert.equal(reloaded?.state, 'AWAITING_APPROVAL');
  assert.equal(reloaded?.auditSeq, 2, 'existing audit chain survived the migration');
  assert.equal(second.loadAgentRunEvents('run_1').length, 2);
  // A pre-v7 run owns no domain payload and no children — absent, not broken.
  assert.equal(reloaded?.domainKind, undefined);
  assert.deepEqual(second.loadAgentRunChildren('run_1'), []);
  second.close();
});

// ── 2–3, 12–13. domain payload ───────────────────────────────────────────────

test('domain payload round-trips through the durable store', () => {
  const store = new SqliteDurableStore(dbPath());
  const payload = initialCodingPayload('Cancelled lines are still counted.');
  const written = serializeDomainPayload(
    { kind: CODING_DOMAIN_KIND, schemaVersion: CODING_PAYLOAD_SCHEMA_VERSION, payload },
    DEFAULT_AGENT_RUN_JOURNAL_CONFIG.maxDomainPayloadBytes,
  );
  assert.ok(written.ok);
  store.insertAgentRun(run({ domainKind: written.kind, domainSchemaVersion: written.schemaVersion, domainPayloadJson: written.json }), createdEvent());

  const read = readDomainPayload<CodingRunPayloadV1>(store.loadAgentRun('run_1')!, { kind: CODING_DOMAIN_KIND, maxSchemaVersion: 1 });
  assert.ok(read.ok);
  assert.deepEqual(read.payload, payload);
  store.close();
});

test('a payload written by a newer build is refused, not parsed on a guess', () => {
  const store = new SqliteDurableStore(dbPath());
  store.insertAgentRun(run({ domainKind: CODING_DOMAIN_KIND, domainSchemaVersion: 99, domainPayloadJson: '{"issueText":"x","phase":"planning","attempts":{"initialProposal":0,"repair":0}}' }), createdEvent());
  const read = readDomainPayload(store.loadAgentRun('run_1')!, { kind: CODING_DOMAIN_KIND, maxSchemaVersion: 1 });
  assert.equal(read.ok, false);
  assert.equal(read.ok === false && read.code, 'UNSUPPORTED_SCHEMA_VERSION');
  store.close();
});

test('a malformed payload faults instead of crashing the journal read', () => {
  const store = new SqliteDurableStore(dbPath());
  store.insertAgentRun(run({ domainKind: CODING_DOMAIN_KIND, domainSchemaVersion: 1, domainPayloadJson: '{"issueText": TRUNCA' }), createdEvent());
  // The run itself must still load — one corrupt payload cannot take the history
  // of every other run down with it.
  const loaded = store.loadAgentRun('run_1');
  assert.ok(loaded);
  assert.equal(store.loadAgentRuns().length, 1);
  const read = readDomainPayload(loaded, { kind: CODING_DOMAIN_KIND, maxSchemaVersion: 1 });
  assert.equal(read.ok === false && read.code, 'MALFORMED');
  store.close();
});

test('an oversize payload is rejected rather than stored short', () => {
  // Many medium strings: each below the redactor's 8 KB string cap and the 200-entry
  // array cap, so this exceeds the byte limit WITHOUT tripping truncation. That
  // separation is what makes TOO_LARGE and REDACTION_LOSSY distinguishable.
  const payload = { issueText: 'x', notes: Array.from({ length: 100 }, () => 'y'.repeat(1_000)) };
  const written = serializeDomainPayload({ kind: CODING_DOMAIN_KIND, schemaVersion: 1, payload }, 16 * 1024);
  assert.equal(written.ok === false && written.code, 'TOO_LARGE');
});

test('a scope larger than the diagnostic redactor caps is stored in FULL, not shortened', () => {
  // The shared `redactValue` would `slice(0, 200)` this array away with no marker,
  // storing a shorter approved scope than the operator approved — undetectable
  // afterwards. The payload redactor must preserve every entry.
  const proposedPaths = Array.from({ length: 250 }, (_, i) => `src/file${i}.ts`);
  const written = serializeDomainPayload({ kind: CODING_DOMAIN_KIND, schemaVersion: 1, payload: { proposedPaths } }, 1024 * 1024);
  assert.ok(written.ok, 'a 250-path scope is legitimate and must be storable');
  assert.deepEqual((JSON.parse(written.json) as { proposedPaths: string[] }).proposedPaths, proposedPaths);

  // A credential SUBSTITUTION is not a loss — that path must still succeed.
  const substituted = serializeDomainPayload({
    kind: CODING_DOMAIN_KIND, schemaVersion: 1, payload: { issueText: 'ok', authorization: 'Bearer abcdefghijklmnop0123456789' },
  }, 65_536);
  assert.ok(substituted.ok, 'redacting a secret is a substitution, not truncation');
  assert.ok(!substituted.json.includes('abcdefghijklmnop0123456789'));
});

test('a payload that cannot be redacted losslessly is refused, never stored short', () => {
  // Past the 8 KB cap `redactString` would append [TRUNCATED] and drop the rest.
  const longString = serializeDomainPayload({ kind: CODING_DOMAIN_KIND, schemaVersion: 1, payload: { issueText: 'x'.repeat(40_000) } }, 1024 * 1024);
  assert.equal(longString.ok === false && longString.code, 'REDACTION_LOSSY');

  // Values with no durable representation are refused rather than stringified.
  const unserializable = serializeDomainPayload({ kind: CODING_DOMAIN_KIND, schemaVersion: 1, payload: { fn: () => 1 } }, 65_536);
  assert.equal(unserializable.ok === false && unserializable.code, 'REDACTION_LOSSY');
});

test('a domain kind without a schema version is refused', () => {
  const bad = serializeDomainPayload({ kind: CODING_DOMAIN_KIND, schemaVersion: 0, payload: {} }, 65_536);
  assert.equal(bad.ok === false && bad.code, 'INVALID_SCHEMA_VERSION');
  const unnamed = serializeDomainPayload({ kind: '  ', schemaVersion: 1, payload: {} }, 65_536);
  assert.equal(unnamed.ok === false && unnamed.code, 'MISSING_KIND');
});

test('redaction applies to the domain payload before it is persisted', () => {
  const written = serializeDomainPayload({
    kind: CODING_DOMAIN_KIND,
    schemaVersion: 1,
    payload: { issueText: 'rotate the key', authorization: 'Bearer abcdefghijklmnop0123456789' },
  }, 65_536);
  assert.ok(written.ok);
  assert.ok(!written.json.includes('abcdefghijklmnop0123456789'), 'credential must not reach the store');
});

// ── 4–11. children ───────────────────────────────────────────────────────────

test('child revisions are monotonic and a stale writer loses', () => {
  const store = new SqliteDurableStore(dbPath());
  store.insertAgentRun(run(), createdEvent());
  const created = child(store);
  assert.ok(created.ok);
  assert.equal(created.child.revision, 1);

  const started = store.transitionAgentRunChild({ childId: 'child_1', expectedRevision: 1, nextState: 'running', at: 2_100, startedAt: 2_100 });
  assert.ok(started.ok);
  assert.equal(started.child.revision, 2);

  // A second writer still holding revision 1 must not win.
  const stale = store.transitionAgentRunChild({ childId: 'child_1', expectedRevision: 1, nextState: 'failed', at: 2_200 });
  assert.equal(stale.ok, false);
  assert.equal(stale.ok === false && stale.code, 'STALE_REVISION');
  assert.equal(store.loadAgentRunChild('child_1')?.state, 'running');
  store.close();
});

test('parent and child revisions advance independently', () => {
  const store = new SqliteDurableStore(dbPath());
  store.insertAgentRun(run(), createdEvent());
  child(store);
  const parentBefore = store.loadAgentRun('run_1')!.version;

  store.transitionAgentRunChild({ childId: 'child_1', expectedRevision: 1, nextState: 'running', at: 2_100 });
  assert.equal(store.loadAgentRun('run_1')!.version, parentBefore, 'a child write must not bump the parent');

  store.transitionAgentRun({ runId: 'run_1', nextState: 'APPROVED', at: 3_000, source: 'APPROVAL', eventType: 'approval.granted' });
  assert.equal(store.loadAgentRun('run_1')!.version, parentBefore + 1);
  assert.equal(store.loadAgentRunChild('child_1')!.revision, 2, 'a parent write must not bump the child');
  store.close();
});

test('a duplicate child id is refused', () => {
  const store = new SqliteDurableStore(dbPath());
  store.insertAgentRun(run(), createdEvent());
  assert.ok(child(store).ok);
  const again = child(store, { kind: 'validation', attempt: 4 });
  assert.equal(again.ok === false && again.code, 'DUPLICATE_CHILD');
  store.close();
});

test('the same (kind, attempt) cannot be registered twice under one run', () => {
  const store = new SqliteDurableStore(dbPath());
  store.insertAgentRun(run(), createdEvent());
  assert.ok(child(store, { childId: 'c1', kind: 'repair_apply', attempt: 1 }).ok);
  const clash = child(store, { childId: 'c2', kind: 'repair_apply', attempt: 1 });
  assert.equal(clash.ok === false && clash.code, 'DUPLICATE_CHILD');
  // A second attempt of the same kind is legitimate and must still be allowed.
  assert.ok(child(store, { childId: 'c3', kind: 'repair_apply', attempt: 2 }).ok);
  store.close();
});

test('a child cannot reference a missing parent', () => {
  const store = new SqliteDurableStore(dbPath());
  const orphan = child(store, { runId: 'run_nonexistent' });
  assert.equal(orphan.ok === false && orphan.code, 'UNKNOWN_PARENT');
  assert.equal(store.loadAgentRunChild('child_1'), undefined, 'nothing was written');
  store.close();
});

test('a child cannot be registered under an already-terminal parent', () => {
  const store = new SqliteDurableStore(dbPath());
  store.insertAgentRun(run({ state: 'COMPLETED', terminalAt: 5_000 }), createdEvent());
  const late = child(store);
  assert.equal(late.ok === false && late.code, 'PARENT_TERMINAL');
  store.close();
});

test('deleting a parent cascades its children away', () => {
  const store = new SqliteDurableStore(dbPath());
  store.insertAgentRun(run({ state: 'COMPLETED', terminalAt: 1 }), createdEvent());
  // Insert while non-terminal is enforced above, so write the child directly for
  // the cascade check by re-creating the run in an approvable state.
  store.close();

  const second = new SqliteDurableStore(dbPath());
  second.insertAgentRun(run(), createdEvent());
  assert.ok(child(second).ok);
  second.transitionAgentRun({ runId: 'run_1', nextState: 'COMPLETED', at: 4_000, source: 'EXECUTION', eventType: 'run.completed', patch: { terminalAt: 4_000 } });
  const pruned = second.pruneAgentRuns(5_000, 10, 6_000);
  assert.equal(pruned.runs, 1);
  assert.deepEqual(second.loadAgentRunChildren('run_1'), [], 'children did not outlive the parent');
  assert.equal(second.loadAgentRunTombstones().length, 1, 'the parent left a tombstone');
  second.close();
});

test('a terminal child can never return to running', () => {
  const store = new SqliteDurableStore(dbPath());
  store.insertAgentRun(run(), createdEvent());
  child(store);
  store.transitionAgentRunChild({ childId: 'child_1', expectedRevision: 1, nextState: 'running', at: 2_100 });
  const done = store.transitionAgentRunChild({ childId: 'child_1', expectedRevision: 2, nextState: 'completed', at: 2_200, endedAt: 2_200, terminalCategory: 'observed_success' });
  assert.ok(done.ok);

  const resurrect = store.transitionAgentRunChild({ childId: 'child_1', expectedRevision: 3, nextState: 'running', at: 2_300 });
  assert.equal(resurrect.ok === false && resurrect.code, 'TERMINAL_CHILD_IMMUTABLE');
  assert.equal(store.loadAgentRunChild('child_1')?.state, 'completed');

  // The rule is in the table, not only in the store.
  assert.equal(isLegalChildTransition('completed', 'running'), false);
  assert.equal(isLegalChildTransition('interrupted', 'completed'), false);
  assert.equal(isLegalChildTransition('created', 'completed'), false, 'undispatched work cannot have succeeded');
  store.close();
});

test('a cancellation request is not a cancellation confirmation', () => {
  const store = new SqliteDurableStore(dbPath());
  store.insertAgentRun(run(), createdEvent());
  child(store);
  store.transitionAgentRunChild({ childId: 'child_1', expectedRevision: 1, nextState: 'running', at: 2_100 });

  const requested = store.transitionAgentRunChild({ childId: 'child_1', expectedRevision: 2, nextState: 'cancelling', at: 2_200, cancellationRequestedAt: 2_200 });
  assert.ok(requested.ok);
  assert.equal(requested.child.state, 'cancelling');
  assert.equal(requested.child.cancellationConfirmedAt, undefined, 'requesting must not confirm');
  assert.equal(requested.child.endedAt, undefined, 'a requested cancellation has not ended the work');

  const confirmed = store.transitionAgentRunChild({ childId: 'child_1', expectedRevision: 3, nextState: 'cancelled', at: 2_300, endedAt: 2_300, cancellationConfirmedAt: 2_300, terminalCategory: 'cancellation_confirmed' });
  assert.ok(confirmed.ok);
  assert.equal(confirmed.child.cancellationConfirmedAt, 2_300);
  // `running → cancelled` directly is refused: work must pass through cancelling.
  assert.equal(isLegalChildTransition('running', 'cancelled'), false);
  store.close();
});

test('required children block parent completion until terminal', () => {
  const persistence = new MemoryAgentRunJournalPersistence();
  const journal = new AgentRunJournal(persistence, DEFAULT_AGENT_RUN_JOURNAL_CONFIG, () => 'ev');
  persistence.insertAgentRun(run(), createdEvent());

  journal.registerChild({ childId: 'c_apply', runId: 'run_1', kind: 'initial_apply', at: 2_000 });
  journal.registerChild({ childId: 'c_opt', runId: 'run_1', kind: 'reconciliation', required: false, at: 2_001 });
  assert.deepEqual(journal.blockingChildren('run_1').map((c) => c.childId), ['c_apply']);

  journal.transitionChild({ childId: 'c_apply', expectedRevision: 1, nextState: 'running', at: 2_100 });
  assert.equal(journal.blockingChildren('run_1').length, 1, 'a running required child still blocks');

  journal.transitionChild({ childId: 'c_apply', expectedRevision: 2, nextState: 'completed', at: 2_200, terminalCategory: 'observed_success' });
  assert.deepEqual(journal.blockingChildren('run_1'), [], 'nothing blocks once every required child is terminal');

  // An INTERRUPTED child is terminal — it stops blocking, but it is not a success,
  // so completion has to consult the category, never mere terminality.
  journal.registerChild({ childId: 'c_val', runId: 'run_1', kind: 'validation', at: 2_300 });
  journal.transitionChild({ childId: 'c_val', expectedRevision: 1, nextState: 'running', at: 2_310 });
  journal.transitionChild({ childId: 'c_val', expectedRevision: 2, nextState: 'interrupted', at: 2_320, terminalCategory: 'interrupted_by_restart' });
  assert.deepEqual(journal.blockingChildren('run_1'), []);
  assert.equal(journal.child('c_val')?.terminalCategory, 'interrupted_by_restart');
});

test('redaction applies to child metadata and terminal evidence', () => {
  const persistence = new MemoryAgentRunJournalPersistence();
  const journal = new AgentRunJournal(persistence, DEFAULT_AGENT_RUN_JOURNAL_CONFIG, () => 'ev');
  persistence.insertAgentRun(run(), createdEvent());

  journal.registerChild({ childId: 'c1', runId: 'run_1', kind: 'validation', at: 2_000, metadata: { authorization: 'Bearer zzzzzzzzzzzzzzzzzzzz' } });
  const registered = journal.child('c1');
  assert.ok(!(registered?.metadataJson ?? '').includes('zzzzzzzzzzzzzzzzzzzz'));

  journal.transitionChild({ childId: 'c1', expectedRevision: 1, nextState: 'running', at: 2_100 });
  journal.transitionChild({
    childId: 'c1', expectedRevision: 2, nextState: 'failed', at: 2_200, terminalCategory: 'observed_failure',
    terminalEvidence: { exitCode: 1, note: `token ${SYNTHETIC_PROVIDER_TOKEN} leaked into output` },
  });
  const finished = journal.child('c1');
  assert.ok(!(finished?.terminalEvidenceJson ?? '').includes(SYNTHETIC_PROVIDER_TOKEN));
});

// ── 14. retention ────────────────────────────────────────────────────────────

test('retention preserves active coding runs and pending approvals', () => {
  const store = new SqliteDurableStore(dbPath());
  // Non-terminal: awaiting approval, far older than the cutoff.
  store.insertAgentRun(run({ runId: 'run_waiting', state: 'AWAITING_APPROVAL', requestedAt: 1, updatedAt: 1 }), createdEvent('run_waiting'));
  // Terminal and old: legitimately prunable.
  store.insertAgentRun(run({ runId: 'run_done', state: 'COMPLETED', terminalAt: 10, requestedAt: 1, updatedAt: 10 }), createdEvent('run_done'));

  const pruned = store.pruneAgentRuns(1_000_000, 100, 2_000_000);
  assert.equal(pruned.runs, 1, 'only the terminal run was pruned');
  assert.ok(store.loadAgentRun('run_waiting'), 'a pending approval is never pruned by age');
  assert.equal(store.loadAgentRun('run_done'), undefined);
  store.close();
});

// ── payload validator ────────────────────────────────────────────────────────

test('the coding payload validator refuses malformed records rather than defaulting', () => {
  assert.equal(parseCodingPayload(null).ok, false);
  assert.equal(parseCodingPayload({ phase: 'planning', attempts: { initialProposal: 0, repair: 0 } }).ok, false);

  const unknownPhase = parseCodingPayload({ issueText: 'x', phase: 'apologising', attempts: { initialProposal: 0, repair: 0 }, childRefs: [] });
  assert.equal(unknownPhase.ok === false && unknownPhase.fault, 'unknown-phase');

  const badAttempts = parseCodingPayload({ issueText: 'x', phase: 'planning', attempts: { initialProposal: -1, repair: 0 }, childRefs: [] });
  assert.equal(badAttempts.ok === false && badAttempts.fault, 'invalid-attempts');

  // A scoped path with no evidence is the failure that matters most: it would be
  // write authority granted over a file nobody read.
  const unevidenced = parseCodingPayload({
    issueText: 'x', phase: 'awaiting_scope_approval', attempts: { initialProposal: 1, repair: 0 },
    childRefs: [], scope: { proposedPaths: ['src/a.ts'], pathSetHash: 'h', sourcesByPath: {}, proposalRevision: 2, proposedAt: 't', approvalExpiresAt: 't2', approvalState: 'pending_display' },
  });
  assert.equal(unevidenced.ok === false && unevidenced.fault, 'invalid-scope');

  // An absent child-reference list would be indistinguishable from "this parent
  // authorised nothing" — a claim reconciliation must never make by accident.
  const noRefs = parseCodingPayload({ issueText: 'x', phase: 'planning', attempts: { initialProposal: 0, repair: 0 } });
  assert.equal(noRefs.ok === false && noRefs.fault, 'invalid-child-refs');

  const badKind = parseCodingPayload({
    issueText: 'x', phase: 'planning', attempts: { initialProposal: 0, repair: 0 },
    childRefs: [{ childId: 'c1', kind: 'coding_step', attempt: 1 }],
  });
  assert.equal(badKind.ok === false && badKind.fault, 'invalid-child-refs', 'a generic step kind is not a coding child kind');

  const duplicateRef = parseCodingPayload({
    issueText: 'x', phase: 'planning', attempts: { initialProposal: 0, repair: 0 },
    childRefs: [{ childId: 'c1', kind: 'validation', attempt: 1 }, { childId: 'c1', kind: 'validation', attempt: 2 }],
  });
  assert.equal(duplicateRef.ok === false && duplicateRef.fault, 'invalid-child-refs');

  const badCancellation = parseCodingPayload({
    issueText: 'x', phase: 'planning', attempts: { initialProposal: 0, repair: 0 }, childRefs: [],
    cancellation: { confirmedAt: 't2' },
  });
  assert.equal(badCancellation.ok === false && badCancellation.fault, 'invalid-cancellation', 'a confirmation with no request is incoherent');

  const unknownApproval = parseCodingPayload({
    issueText: 'x', phase: 'awaiting_scope_approval', attempts: { initialProposal: 1, repair: 0 },
    childRefs: [], scope: { proposedPaths: [], pathSetHash: 'h', sourcesByPath: {}, proposalRevision: 2, proposedAt: 't', approvalExpiresAt: 't2', approvalState: 'definitely_fine' },
  });
  assert.equal(unknownApproval.ok === false && unknownApproval.fault, 'invalid-scope');
});

test('a well-formed coding payload survives a serialize → store → parse cycle', () => {
  const store = new SqliteDurableStore(dbPath());
  const payload: CodingRunPayloadV1 = {
    issueText: 'Cancelled line items are still counted in the order total.',
    phase: 'awaiting_scope_approval',
    attempts: { initialProposal: 1, repair: 0 },
    childRefs: [{ childId: 'c_plan', kind: 'repository_planning', attempt: 1 }],
    scope: {
      proposedPaths: ['src/services/orderTotalsService.js'],
      pathSetHash: '590eb93b42d7bc73',
      sourcesByPath: { 'src/services/orderTotalsService.js': [{ path: 'src/services/orderTotalsService.js', startLine: 1, endLine: 40, excerptHash: 'abc123' }] },
      proposalRevision: 3,
      proposedAt: '2026-08-01T00:00:00.000Z',
      approvalExpiresAt: '2026-08-01T00:05:00.000Z',
      approvalState: 'displayed',
    },
  };
  const written = serializeDomainPayload({ kind: CODING_DOMAIN_KIND, schemaVersion: 1, payload }, 65_536);
  assert.ok(written.ok);
  store.insertAgentRun(run({ domainKind: written.kind, domainSchemaVersion: written.schemaVersion, domainPayloadJson: written.json }), createdEvent());

  const read = readDomainPayload(store.loadAgentRun('run_1')!, { kind: CODING_DOMAIN_KIND, maxSchemaVersion: 1 });
  assert.ok(read.ok);
  const parsed = parseCodingPayload(read.payload);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.payload, payload);
  store.close();
});
