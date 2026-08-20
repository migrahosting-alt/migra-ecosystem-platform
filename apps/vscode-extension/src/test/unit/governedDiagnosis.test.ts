import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  DIAGNOSE_WORKFLOW,
  buildDiagnosisPrompt,
  collectFailureEvidence,
} from '../../commands/diagnoseFailureModel.js';
import { GOVERNED_WORKFLOWS, taskClassPayload } from '../../capability/workflowClassification.js';

/**
 * The first governed surface, end to end from the host side.
 *
 * `repository-diagnosis` is deliberately the first one wired: the benchmark measured it as
 * ADVISORY on the deep local model, so it exercises the whole chain — declared class,
 * authority decision, tool gate — while keeping read tools and blocking nothing an operator
 * was already doing. A denied class would prove refusal without proving the read path
 * survives; a mutating class would put an approval prompt in front of the thing under test.
 */

function source(rel: string): string {
  return readFileSync(join(__dirname, '..', '..', '..', 'src', rel), 'utf8');
}

const doc = {
  fileName: '/repo/src/embedder.ts',
  languageId: 'typescript',
  lineCount: 6,
  lineAt: (n: number) => ({ text: ['const a = 1;', 'const b = 2;', 'out.push(x);', 'return out;', '}', ''][n] ?? '' }),
};

const diagnostics = [
  { range: { start: { line: 2 } }, severity: 0, message: "Type 'undefined' is not assignable", source: 'ts' },
  { range: { start: { line: 3 } }, severity: 1, message: 'Prefer const', source: 'eslint' },
  { range: { start: { line: 4 } }, severity: 2, message: 'Consider extracting', source: 'hint' },
  { range: { start: { line: 5 } }, severity: 3, message: 'Spelling', source: 'cspell' },
];

// ── the workflow declares the class ──────────────────────────────────────────

test('the command speaks for exactly one workflow, which maps to repository-diagnosis', () => {
  assert.equal(DIAGNOSE_WORKFLOW, 'diagnose.failure');
  assert.equal(GOVERNED_WORKFLOWS[DIAGNOSE_WORKFLOW], 'repository-diagnosis');
  assert.deepEqual(taskClassPayload(DIAGNOSE_WORKFLOW), {
    taskClass: 'repository-diagnosis',
    workflow: 'diagnose.failure',
  });
});

test('the class and its provenance are sent TOGETHER or not at all', () => {
  // A class without its workflow is the weaker audit record; a workflow without a class
  // would imply authority nothing granted.
  const governed = taskClassPayload(DIAGNOSE_WORKFLOW) as Record<string, string>;
  assert.ok(governed.taskClass && governed.workflow);
  assert.deepEqual(taskClassPayload('not.a.workflow'), {});
  assert.deepEqual(taskClassPayload(undefined), {});
});

test('the command declares its class from the host constant, never from the prompt', () => {
  const command = source('commands/diagnoseFailure.ts');
  // Sourced from the shared map, so a rename cannot silently change the authority.
  assert.match(command, /taskClass: GOVERNED_WORKFLOWS\[DIAGNOSE_WORKFLOW\]/);
  assert.match(command, /workflow: DIAGNOSE_WORKFLOW/);
  // The prompt deliberately contains the word "diagnose" — proof the class does not come
  // from wording, because the same word in ordinary chat grants nothing.
  assert.match(buildDiagnosisPrompt(collectFailureEvidence(doc, diagnostics)), /^Diagnose this failure/);
  assert.deepEqual(taskClassPayload(undefined), {}, 'the same word typed into chat stays ungoverned');
});

test('this command can never apply an edit', () => {
  const command = source('commands/diagnoseFailure.ts');
  // Fix Diagnostics proposes and applies; this one only explains. Read-only by
  // construction rather than by the Brain happening to withhold the tools.
  for (const mutating of ['previewAndMaybeApplyProposedEdits', 'ProposedEdit', 'applyEdit(edit)']) {
    if (mutating === 'applyEdit(edit)') continue; // it writes its OWN output document only
    assert.ok(!command.includes(mutating), `the diagnosis command must not reference ${mutating}`);
  }
  // Its only write is the markdown buffer it renders into.
  const writes = [...command.matchAll(/applyEdit\(/g)].length;
  assert.equal(writes, 1, 'exactly one write, and it is the output document');
  assert.match(command, /openTextDocument\(\{ language: 'markdown'/);
});

// ── evidence collection is bounded and relevant ──────────────────────────────

test('only errors and warnings become evidence', () => {
  const evidence = collectFailureEvidence(doc, diagnostics);
  assert.equal(evidence.diagnostics.length, 2, 'hints and information are editor noise');
  assert.deepEqual(evidence.diagnostics.map((d) => d.severity), ['error', 'warning']);
  assert.equal(evidence.diagnostics[0]!.line, 3, '0-based ranges become 1-based lines');
  assert.equal(evidence.diagnostics[0]!.source, 'ts');
});

test('the excerpt is bounded and centred on the first problem', () => {
  const big = { ...doc, lineCount: 5000, lineAt: (n: number) => ({ text: `line ${n}` }) };
  const evidence = collectFailureEvidence(big, [{ range: { start: { line: 2000 } }, severity: 0, message: 'boom' }]);
  const lines = evidence.excerpt.split('\n');
  assert.ok(lines.length <= 120, `excerpt must stay bounded, got ${lines.length}`);
  // Centred on the failure: an unbounded excerpt would crowd out the diagnostics themselves.
  assert.ok(evidence.excerpt.includes('line 2000'));
});

test('the prompt carries the evidence and forbids invention', () => {
  const prompt = buildDiagnosisPrompt(collectFailureEvidence(doc, diagnostics));
  assert.match(prompt, /Do not invent APIs or files that are not shown/);
  assert.match(prompt, /If the evidence is insufficient, say so/);
  assert.match(prompt, /line 3 \[error ts\] Type 'undefined' is not assignable/);
  assert.match(prompt, /embedder\.ts \(typescript\)/);
});

// ── registration and cancellation ────────────────────────────────────────────

test('the command is registered and activated', () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8')) as {
    activationEvents: string[];
    contributes: { commands: Array<{ command: string; title: string }> };
  };
  assert.ok(pkg.activationEvents.includes('onCommand:migrapilot.diagnoseFailure'));
  const entry = pkg.contributes.commands.find((c) => c.command === 'migrapilot.diagnoseFailure');
  assert.equal(entry?.title, 'MigraPilot: Debug a Failure');
  assert.match(source('extension.ts'), /registerCommand\('migrapilot\.diagnoseFailure'/);
});

test('cancellation reaches the in-flight turn', () => {
  // The command surface speaks VS Code tokens and the turn speaks AbortSignal. Dropping the
  // link would leave a cancelled diagnosis still running against the Brain.
  const command = source('commands/diagnoseFailure.ts');
  assert.match(command, /new AbortController\(\)/);
  assert.match(command, /token\.onCancellationRequested\(\(\) => controller\.abort\(\)\)/);
  assert.match(command, /controller\.signal/);
});

test('informational notices are fire-and-forget, so the command cannot hang on a toast', () => {
  // Awaiting `showInformationMessage` leaves the command pending until the notification is
  // dismissed. An operator who ignores the toast has a command that never finishes, and an
  // automated run blocks until timeout — which is exactly how this was found, in the
  // packaged VSIX run and not in any unit test.
  const command = source('commands/diagnoseFailure.ts');
  assert.ok(!/await vscode\.window\.show(Information|Warning)Message/.test(command),
    'an early-return notice must not be awaited');
  assert.equal([...command.matchAll(/void vscode\.window\.show(Information|Warning)Message/g)].length, 3);
});

// ── the third frame is rendered ──────────────────────────────────────────────

test('the capability frame is rendered by the host, alongside the other two', () => {
  const turn = source('chat/engineerTurn.ts');
  // The Brain emitted this frame from the previous slice and nothing rendered it — the
  // authority disclosure existed on the wire and was invisible to the operator.
  assert.match(turn, /ev\.event === 'capability'/);
  assert.match(turn, /ev\.event === 'grounding'/);
  assert.match(turn, /ev\.event === 'liveKnowledge'/);
});

test('a capability refusal does not wear the grounding refusal wording', () => {
  const turn = source('chat/engineerTurn.ts');
  // Two boundaries now refuse. Rendering a capability denial as "insufficient approved
  // evidence" would send an operator to re-approve an index that was never the problem.
  assert.match(turn, /d\.code === 'CAPABILITY_DENIED'/);
  assert.match(turn, /\*\*Capability authority denied\.\*\*/);
  assert.match(turn, /No model was called for this request/);
  assert.match(turn, /\*\*Insufficient approved evidence\.\*\*/, 'the grounding wording still exists for its own case');
});
