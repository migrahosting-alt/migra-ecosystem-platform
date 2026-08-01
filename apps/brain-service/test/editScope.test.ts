// The approved edit scope — the boundary the 2026-08-01 governance change rests on.
//
// The loop may now write, which it could not before. What makes that safe is not
// trust: it is that the file set was declared before any mutation, justified by
// retrieved evidence, approved as a whole, and enforced on every write. These
// tests are that claim, made falsifiable. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  proposeEditScope,
  approveEditScope,
  assertWithinScope,
  approvalMatches,
  describeScope,
  ScopedEditLedger,
  EditScopeError,
  MAX_SCOPE_FILES,
  SCOPE_TTL_MS,
} from '../src/engine/coding/editScope.js';
import { REQUIRED_FILES, TRAP_FILE } from './fixtures/multifileCodingFixture.js';

const SRC = (path: string) => ({ path, startLine: 1, endLine: 9, excerptHash: 'a1b2c3d4e5f60718' });

function request(paths: readonly string[] = REQUIRED_FILES) {
  return {
    runId: 'run_1',
    rationale: 'Cancelled lines must be excluded and the excluded count reported.',
    files: paths.map((p) => ({ path: p, reason: `evidence shows ${p} participates in the total`, sources: [SRC(p)] })),
  };
}

test('a scope cannot be declared without evidence for each file', () => {
  assert.throws(
    () => proposeEditScope({ runId: 'r', rationale: 'x', files: [{ path: 'src/a.js', reason: 'hunch', sources: [] }] }),
    (e: EditScopeError) => e.code === 'file-without-evidence',
  );
  // …and the same file WITH evidence is accepted.
  assert.equal(proposeEditScope(request(['src/a.js'])).files.length, 1);
});

test('a scope refuses absolute, escaping, duplicate, empty and oversized path sets', () => {
  const bad = (files: Array<{ path: string; reason: string; sources: ReturnType<typeof SRC>[] }>, code: string): void =>
    assert.throws(() => proposeEditScope({ runId: 'r', rationale: 'x', files }), (e: EditScopeError) => e.code === code);

  bad([], 'no-files');
  // A leading slash must be REFUSED, never normalised away into a plausible
  // relative path — the earlier implementation turned `/etc/passwd` into
  // `etc/passwd` and admitted it.
  for (const escape of ['/etc/passwd', '../outside.js', 'src/../../outside.js', 'C:\\Windows\\system32', '\\\\server\\share', '   ']) {
    bad([{ path: escape, reason: 'r', sources: [SRC('x')] }], 'absolute-or-escaping-path');
  }
  bad([{ path: 'src/a.js', reason: 'r', sources: [SRC('x')] }, { path: 'src/a.js', reason: 'r', sources: [SRC('x')] }], 'duplicate-path');
  bad(
    Array.from({ length: MAX_SCOPE_FILES + 1 }, (_, i) => ({ path: `src/f${i}.js`, reason: 'r', sources: [SRC('x')] })),
    'too-many-files',
  );
});

test('an approved scope admits its own files and refuses everything else', () => {
  const scope = approveEditScope(proposeEditScope(request()));
  for (const file of REQUIRED_FILES) {
    assert.doesNotThrow(() => assertWithinScope(scope, file, scope.approvalToken));
  }
  // The trap file is the whole point: adjacent, similarly named, and unapproved.
  assert.throws(
    () => assertWithinScope(scope, TRAP_FILE, scope.approvalToken),
    (e: EditScopeError) => e.code === 'scope-violation' && /outside the approved edit scope/.test(e.message),
  );
});

test('the scope is FROZEN — a re-proposal with new paths cannot use the old approval', () => {
  const scope = approveEditScope(proposeEditScope(request()));
  const widened = proposeEditScope(request([...REQUIRED_FILES, TRAP_FILE]));

  // Same run, same rationale, different path set → a different hash, so the old
  // token does not bind. A scope that can grow after approval is not a scope.
  assert.notEqual(widened.scopeHash, scope.scopeHash);
  assert.equal(approvalMatches({ ...widened, approvalToken: scope.approvalToken, approvedAt: 0, expiresAt: Date.now() + 1000 }, scope.approvalToken), false);
});

test('a mismatched or foreign approval token is refused', () => {
  const scope = approveEditScope(proposeEditScope(request()));
  const other = approveEditScope(proposeEditScope(request(['src/other.js'])));
  for (const token of ['', 'scopeapv_forged', other.approvalToken]) {
    assert.throws(
      () => assertWithinScope(scope, REQUIRED_FILES[0]!, token),
      (e: EditScopeError) => e.code === 'approval-mismatch',
    );
  }
});

test('an expired approval refuses even an in-scope file', () => {
  const t0 = 1_000_000;
  const scope = approveEditScope(proposeEditScope(request(), t0), t0);
  assert.doesNotThrow(() => assertWithinScope(scope, REQUIRED_FILES[0]!, scope.approvalToken, t0 + SCOPE_TTL_MS - 1));
  assert.throws(
    () => assertWithinScope(scope, REQUIRED_FILES[0]!, scope.approvalToken, t0 + SCOPE_TTL_MS),
    (e: EditScopeError) => e.code === 'scope-expired',
  );
});

test('the ledger records refusals, not just successes', () => {
  const scope = approveEditScope(proposeEditScope(request()));
  const ledger = new ScopedEditLedger(scope, scope.approvalToken);

  assert.equal(ledger.admit(REQUIRED_FILES[0]!), true);
  assert.equal(ledger.admit(REQUIRED_FILES[1]!), true);
  assert.equal(ledger.admit(TRAP_FILE), false, 'the trap is refused');
  assert.equal(ledger.admit(REQUIRED_FILES[0]!), true, 'a second write to an approved file is fine');

  assert.deepEqual(ledger.applied, [REQUIRED_FILES[0], REQUIRED_FILES[1]]);
  assert.equal(ledger.refused.length, 1);
  assert.match(ledger.refused[0]!.reason!, /outside the approved edit scope/);
  // A truthful report must be able to say "it tried and was stopped".
  assert.equal(ledger.history.length, 4);
});

test('the ledger reports approved-but-unwritten files as a plan/act gap', () => {
  const scope = approveEditScope(proposeEditScope(request()));
  const ledger = new ScopedEditLedger(scope, scope.approvalToken);
  ledger.admit(REQUIRED_FILES[0]!);
  // Claiming a three-file change while touching one is exactly the kind of
  // unverified completion this project exists to stop.
  assert.deepEqual(ledger.unusedScope, [REQUIRED_FILES[1], REQUIRED_FILES[2]]);
});

test('the approval prompt shows the operator the paths and their evidence', () => {
  const proposed = proposeEditScope(request());
  const text = describeScope(proposed);
  for (const file of REQUIRED_FILES) assert.ok(text.includes(file), `${file} is shown`);
  assert.match(text, /evidence: /);
  assert.match(text, /No file outside this list may be written under this approval\./);
  assert.ok(!text.includes(TRAP_FILE));
});
