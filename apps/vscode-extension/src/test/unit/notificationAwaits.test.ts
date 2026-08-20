import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * The static rule that closes the awaited-notification defect class.
 *
 * `showInformationMessage` and friends resolve when the toast is DISMISSED. Awaiting one
 * whose result nobody reads keeps the surrounding command pending until the operator clicks
 * it away — so a command whose notification is ignored never completes. Two of the first two
 * commands audited carried it, months apart, which is why this is enforced rather than
 * remembered.
 *
 * The rule must reject ONLY unused results. Banning the API would break the confirmation
 * flows that are its legitimate use, and those are the destructive paths where an unawaited
 * prompt would be far worse than a hang.
 */

const EXT_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(EXT_ROOT, 'scripts', 'check-notification-awaits.mjs');
const PROBE = join(EXT_ROOT, 'src', 'interaction', '__probe-notify.ts');

function check(): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT], { cwd: EXT_ROOT, encoding: 'utf8' });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function withProbe(contents: string, assertion: (r: ReturnType<typeof check>) => void): void {
  writeFileSync(PROBE, contents);
  try {
    assertion(check());
  } finally {
    rmSync(PROBE, { force: true });
    check(); // regenerate the artifact so a probe cannot leave it poisoned
  }
}

test('the codebase has no discarded awaited notification results', () => {
  const r = check();
  assert.equal(r.status, 0, `violations remain:\n${r.stderr}`);
  assert.match(r.stdout, /22 consumed, 0 discarded, 0 ambiguous/);
});

test('a DISCARDED awaited result is rejected', () => {
  withProbe(
    `import * as vscode from 'vscode';
     export async function probe(): Promise<void> {
       await vscode.window.showInformationMessage('nobody reads this');
     }`,
    (r) => {
      assert.equal(r.status, 1);
      assert.match(r.stderr, /DISCARDED/);
      assert.match(r.stderr, /__probe-notify\.ts/);
      assert.match(r.stderr, /use `void vscode\.window\.show…Message\(\.\.\.\)`/);
    },
  );
});

test('all three message APIs are covered', () => {
  for (const api of ['showInformationMessage', 'showWarningMessage', 'showErrorMessage']) {
    withProbe(
      `import * as vscode from 'vscode';
       export async function probe(): Promise<void> { await vscode.window.${api}('x'); }`,
      (r) => assert.equal(r.status, 1, `${api} must be checked`),
    );
  }
});

test('a CONSUMED result is permitted — confirmation flows must keep working', () => {
  // The legitimate use, and the one a blanket ban would break. These are destructive paths
  // where an unawaited prompt would be a far worse defect than a hang.
  withProbe(
    `import * as vscode from 'vscode';
     export async function probe(): Promise<boolean> {
       const choice = await vscode.window.showWarningMessage('Delete this resource?', { modal: true }, 'Delete');
       return choice === 'Delete';
     }`,
    (r) => assert.equal(r.status, 0, `a consumed result must be allowed:\n${r.stderr}`),
  );
});

test('other consuming positions are permitted', () => {
  withProbe(
    `import * as vscode from 'vscode';
     export async function probe(): Promise<void> {
       if (await vscode.window.showWarningMessage('a', 'Yes')) { /* branch */ }
       const label = (await vscode.window.showInformationMessage('b', 'Ok')) ?? 'none';
       console.log(label, await vscode.window.showErrorMessage('c', 'Retry'));
     }`,
    (r) => assert.equal(r.status, 0, `consuming positions must be allowed:\n${r.stderr}`),
  );
});

test('`void await` is still a discarded result', () => {
  // Explicitly voiding an awaited result does not make the await useful — the command still
  // waits for the dismissal.
  withProbe(
    `import * as vscode from 'vscode';
     export async function probe(): Promise<void> { void (await vscode.window.showInformationMessage('x')); }`,
    (r) => assert.equal(r.status, 1, 'void await must still be rejected'),
  );
});

test('a non-window method of the same name is NOT swept up', () => {
  // The rule targets the VS Code notification APIs, not every method that happens to share a
  // name. Over-matching would push authors to disable the check entirely.
  withProbe(
    `const reporter = { async showErrorMessage(_m: string): Promise<void> {} };
     export async function probe(): Promise<void> { await reporter.showErrorMessage('not vscode'); }`,
    (r) => assert.equal(r.status, 0, `unrelated APIs must be ignored:\n${r.stderr}`),
  );
});

test('the inventory artifact records every call with its classification', () => {
  check();
  const artifact = JSON.parse(
    readFileSync(join(EXT_ROOT, 'src', 'interaction', 'generated', 'notification-awaits.generated.json'), 'utf8'),
  ) as {
    generated: string;
    rule: string;
    counts: Record<string, number>;
    findings: Array<{ file: string; line: number; api: string; classification: string }>;
  };

  assert.match(artifact.generated, /DERIVED EVIDENCE, do not edit/);
  assert.match(artifact.rule, /prohibited when the result is discarded/);
  assert.equal(artifact.counts.discarded, 0);
  assert.equal(artifact.counts.ambiguous, 0);
  assert.equal(artifact.findings.length, artifact.counts.consumed);
  // Every finding is locatable and classified — an inventory without positions is a count.
  for (const f of artifact.findings) {
    assert.ok(f.file.endsWith('.ts') && f.line > 0, `unlocatable finding: ${JSON.stringify(f)}`);
    assert.ok(['showInformationMessage', 'showWarningMessage', 'showErrorMessage'].includes(f.api));
    assert.equal(f.classification, 'consumed');
  }
});
