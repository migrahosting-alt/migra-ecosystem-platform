// The Brain owns orchestration; clients express context and authority.
//
// Two clients deciding the same thing drifted into OPPOSITE bugs: the consumer
// answered "build this page" with a description, the extension entered the build
// agent whenever an image produced a design spec. Sharing an intent contract
// stopped them disagreeing but not DECIDING — two copies of a correct decision
// still drift. These tests pin the single decision and its authority split.

import assert from 'node:assert/strict';
import test from 'node:test';

import { decideOrchestration, authorityFrom } from '../src/engine/orchestration/decide.js';
import type { OrchestrationRequest } from '@migrapilot/shared-types/orchestration-decision';

const WORKSPACE = { kind: 'vscode-workspace' as const, label: 'the open workspace', canRead: true, canPropose: true, canApply: true };
const NONE = { kind: 'none' as const };
const PNG = ['image/png'];

const ask = (objective: string, attachments: string[], authority: OrchestrationRequest['authority'], surface: OrchestrationRequest['surface'] = 'vscode-extension') =>
  decideOrchestration({ objective, attachmentMimeTypes: attachments, authority, surface });

test('DESCRIBE terminates after vision and never reaches the engineer', () => {
  const d = ask('what is in this image?', PNG, WORKSPACE);
  assert.equal(d.intent, 'describe');
  assert.equal(d.requiresVision, true);
  assert.equal(d.visionIsTerminal, true);
  assert.equal(d.requiresEngineer, false, 'a description must never enter the build path');
  assert.equal(d.terminalStep, 'vision.read');
});

test('BUILD sequences vision, spec, engineer, workspace, changeset, verification', () => {
  const d = ask('build this page', PNG, WORKSPACE);
  assert.equal(d.intent, 'implement');
  assert.deepEqual(
    d.steps.map((s) => s.step),
    ['vision.read', 'design.spec', 'engineer.plan', 'workspace.inspect', 'changeset.propose', 'verification'],
  );
  assert.equal(d.visionIsTerminal, false, 'the design read must not be able to answer a build request');
  assert.equal(d.terminalStep, 'verification');
  assert.equal(d.executable, true);
});

test('PLAIN ENGINEERING still reaches the engineer with no image and no vision stage', () => {
  // Caught live: this returned intent=converse with eng=false, so an ordinary
  // coding request would never have reached the agent once clients follow the
  // Brain's decision. The extension was masking it with a local fallback — the
  // exact local decision-making this slice removes.
  const d = ask('add a health endpoint to the server', [], WORKSPACE);
  assert.equal(d.requiresVision, false, 'no image means no vision stage');
  assert.equal(d.requiresEngineer, true, 'an ordinary workspace turn must reach the agent');
  assert.equal(d.executable, true);
  assert.equal(d.steps.some((s) => s.step === 'vision.read'), false);
});

test('the SAME ordinary turn without a project is a conversation, not a build', () => {
  // Authority decides the shape, not phrasing and not the surface.
  const d = ask('add a health endpoint to the server', [], NONE, 'migrapilot-consumer');
  assert.equal(d.requiresEngineer, false);
  assert.equal(d.executable, true, 'a plain conversation needs no project and must not fail');
});

test('NO AUTHORITY fails at the exact boundary, not earlier and not silently', () => {
  const d = ask('build this page', PNG, NONE, 'migrapilot-consumer');
  assert.equal(d.executable, false);
  assert.equal(d.failureBoundary, 'workspace.inspect');
  assert.match(d.reason, /no project is connected/);
  // The steps before it are still permitted — the failure is at the true edge.
  const upTo = d.steps.slice(0, d.steps.findIndex((s) => s.step === 'workspace.inspect'));
  assert.ok(upTo.every((s) => s.permitted));
});

test('PARITY: both surfaces get the SAME decision for the same request', () => {
  const cases: Array<[string, string[]]> = [
    ['what is in this image?', PNG],
    ['build this page', PNG],
    ['add a health endpoint to the server', []],
    ['recreate this component', PNG],
  ];
  for (const [objective, attachments] of cases) {
    const ext = ask(objective, attachments, WORKSPACE, 'vscode-extension');
    const con = ask(objective, attachments, WORKSPACE, 'migrapilot-consumer');
    // Surface is provenance only. A decision that varied by it would rebuild
    // "consumer = planner, extension = builder" through the back door.
    assert.deepEqual(con, ext, `surfaces disagreed on "${objective}"`);
  }
});

test('the same request differs ONLY by authority, never by surface', () => {
  const withWorkspace = ask('build this page', PNG, WORKSPACE, 'migrapilot-consumer');
  const without = ask('build this page', PNG, NONE, 'vscode-extension');
  assert.equal(withWorkspace.executable, true, 'a consumer WITH authority can build');
  assert.equal(without.executable, false, 'an extension WITHOUT authority cannot');
  // Identical plans; only permission differs.
  assert.deepEqual(withWorkspace.steps.map((s) => s.step), without.steps.map((s) => s.step));
});

test('a declared authority that omits a permission does NOT get it', () => {
  const a = authorityFrom({ kind: 'connected-repo', label: 'repo' });
  assert.equal(a.canRead, false);
  assert.equal(a.canPropose, false);
  assert.equal(a.canApply, false);
});

test('read-only authority stops at propose, after inspection was permitted', () => {
  const d = ask('build this page', PNG, { kind: 'connected-repo', label: 'the repo', canRead: true, canPropose: false });
  assert.equal(d.failureBoundary, 'changeset.propose');
  assert.equal(d.steps.find((s) => s.step === 'workspace.inspect')?.permitted, true);
});

test('the convenience flags are derived from the steps, never a second opinion', () => {
  for (const [objective, attachments] of [['build this page', PNG], ['what is in this image?', PNG], ['fix the bug', []]] as const) {
    const d = ask(objective, attachments as string[], WORKSPACE);
    assert.equal(d.requiresVision, d.steps.some((s) => s.step === 'vision.read'));
    assert.equal(d.requiresEngineer, d.steps.some((s) => s.step === 'engineer.plan'));
    assert.equal(d.visionIsTerminal, d.steps.some((s) => s.step === 'vision.read' && s.terminal));
  }
});

test('the decision names its plan revision, so evidence says what decided', () => {
  assert.match(ask('hello', [], NONE).planRevision, /^orchestration\/\d+\.\d+\.\d+$/);
});
