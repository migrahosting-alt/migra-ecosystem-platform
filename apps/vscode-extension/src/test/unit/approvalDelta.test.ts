import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type ActionChange,
  buildConsentView,
  diffObjects,
  displayValue,
  isInternalField,
  isSensitiveValueField,
  renderActionConsent,
} from '../../services/approvalDelta.js';

// ── field classification ─────────────────────────────────────────────────────

test('internal/correlation/approval fields are classified internal (omitted)', () => {
  for (const f of ['approvalId', 'approvalToken', 'actionId', 'runId', 'requestId', 'correlationId', 'idempotencyKey', 'jwt', 'bearerToken', 'authorization', '_meta']) {
    assert.equal(isInternalField(f), true, f);
  }
  for (const f of ['mode', 'owner', 'id', 'name', 'size']) {
    assert.equal(isInternalField(f), false, f);
  }
});

test('sensitive value fields are classified for redaction', () => {
  for (const f of ['password', 'secret', 'apiKey', 'api_key', 'privateKey', 'credential', 'sessionToken']) {
    assert.equal(isSensitiveValueField(f), true, f);
  }
  assert.equal(isSensitiveValueField('mode'), false);
});

test('displayValue redacts sensitive, shows null, quotes strings, summarizes arrays', () => {
  assert.equal(displayValue('secret', 'hunter2'), '‹redacted›');
  assert.equal(displayValue('note', null), 'null');
  assert.equal(displayValue('name', 'sample.ts'), '"sample.ts"');
  assert.equal(displayValue('count', 3), '3');
  assert.equal(displayValue('items', [1, 2, 3]), '[3 item(s)]');
});

// ── diff = delta, not whole object ───────────────────────────────────────────

test('diff emits only changed fields, omits internal, redacts sensitive, recurses nested', () => {
  const before = {
    mode: '0644',
    owner: 'root', // unchanged → must NOT appear
    secret: 'OLD',
    approvalToken: 'tok-old', // internal → omitted
    runId: 'r1', // internal → omitted
    nested: { retries: 1, level: 'low' },
  };
  const after = {
    mode: '0755',
    owner: 'root',
    secret: 'NEW',
    approvalToken: 'tok-new',
    runId: 'r1',
    nested: { retries: 2, level: 'low' },
    note: null,
  };
  const lines = diffObjects(before, after);
  const fields = lines.map((l) => l.field);

  assert.ok(!fields.includes('owner'), 'unchanged field excluded (not whole object)');
  assert.ok(!fields.some((f) => f.toLowerCase().includes('approvaltoken')), 'internal omitted');
  assert.ok(!fields.some((f) => f.toLowerCase().includes('runid')), 'internal omitted');

  const mode = lines.find((l) => l.field === 'mode')!;
  assert.deepEqual([mode.kind, mode.before, mode.after], ['changed', '"0644"', '"0755"']);

  const secret = lines.find((l) => l.field === 'secret')!;
  assert.deepEqual([secret.before, secret.after], ['‹redacted›', '‹redacted›'], 'sensitive value redacted');

  const nested = lines.find((l) => l.field === 'nested.retries')!;
  assert.deepEqual([nested.kind, nested.before, nested.after], ['changed', '1', '2'], 'nested dotted path');

  const note = lines.find((l) => l.field === 'note')!;
  assert.deepEqual([note.kind, note.after], ['added', 'null'], 'null-valued add shown as null, not omitted');
});

test('omitted key (present before, absent after) → removed; distinct from null', () => {
  const lines = diffObjects({ a: 1, b: 2 }, { a: 1 });
  const b = lines.find((l) => l.field === 'b')!;
  assert.equal(b.kind, 'removed');
  assert.equal(b.before, '2');

  const nulled = diffObjects({ a: 1 }, { a: null });
  const a = nulled.find((l) => l.field === 'a')!;
  assert.deepEqual([a.kind, a.after], ['changed', 'null']);
});

// ── operation semantics (partial vs full replacement must be unambiguous) ─────

test('update wording marks it partial; replace wording marks it full', () => {
  const update = buildConsentView({ op: 'update', resource: { type: 'file', name: 'x' }, before: { a: 1 }, after: { a: 2 } });
  assert.equal(update.operationLabel, 'Update');
  assert.match(update.operationSemantics, /only the fields listed below change|other fields are left unchanged/i);
  assert.doesNotMatch(update.operationSemantics, /entire|replace/i);

  const replace = buildConsentView({ op: 'replace', resource: { type: 'file', name: 'x' }, before: { a: 1 }, after: { a: 2 } });
  assert.equal(replace.operationLabel, 'Replace');
  assert.match(replace.operationSemantics, /entire|removed or reset/i);
});

test('create lists new fields; delete states full deletion; append counts items', () => {
  const create = buildConsentView({ op: 'create', resource: { type: 'mailbox', name: 'm1' }, after: { quota: 10 } });
  assert.equal(create.operationLabel, 'Create');
  assert.equal(create.lines.find((l) => l.field === 'quota')?.kind, 'added');

  const del = buildConsentView({ op: 'delete', resource: { type: 'mailbox', name: 'm1' }, before: { quota: 10 } });
  assert.match(del.operationSemantics, /Deletes the entire/i);
  assert.equal(del.lines.find((l) => l.field === 'quota')?.kind, 'removed');

  const append = buildConsentView({ op: 'append', resource: { type: 'list', name: 'allow' }, appended: ['a', 'b'] });
  assert.equal(append.operationLabel, 'Append');
  assert.match(append.operationSemantics, /Appends 2 item\(s\)|existing items are unchanged/i);
  assert.equal(append.lines.length, 2);
});

// ── rendered markdown never leaks internal/sensitive material ─────────────────

test('rendered consent markdown contains delta but no internal/secret material', () => {
  const change: ActionChange = {
    op: 'update',
    resource: { type: 'file', name: 'sample.ts', id: 'res-123' },
    before: { mode: '0644', secret: 'OLD-SECRET', approvalToken: 'tok-old', requestId: 'req-9' },
    after: { mode: '0755', secret: 'NEW-SECRET', approvalToken: 'tok-new', requestId: 'req-9' },
  };
  const md = renderActionConsent(change);

  // Present: operation, resource, changed field.
  assert.match(md, /Update — file "sample\.ts"/);
  assert.match(md, /`mode`/);
  assert.match(md, /0755/);

  // Absent: any internal id/token or secret value.
  for (const forbidden of ['approvalToken', 'tok-old', 'tok-new', 'requestId', 'req-9', 'OLD-SECRET', 'NEW-SECRET']) {
    assert.ok(!md.includes(forbidden), `must not leak ${forbidden}`);
  }
  assert.match(md, /‹redacted›/, 'secret shown as redacted');
});

test('empty delta renders a clear no-visible-change note (never a raw dump)', () => {
  const md = renderActionConsent({ op: 'update', resource: { type: 'file', name: 'x' }, before: { a: 1, runId: 'r' }, after: { a: 1, runId: 'r' } });
  assert.match(md, /no user-visible field changes/i);
});
