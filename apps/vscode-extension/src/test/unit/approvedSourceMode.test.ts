import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  SLASH_COMMANDS,
  SOURCE_MODE_OPTIONS,
  requiresApprovedEvidence,
  sourceModeBadge,
} from '../../panel/shell/composerModel.js';

/**
 * The approved-only boundary must be ACTIVATED by the installed path.
 *
 * The Brain's fail-closed branch is unreachable unless the extension sends
 * `requireApproved: true`. In the historical failure (run corr_ms1iwdhw4lbyim) the
 * request carried no such field, so the same prompt that asked for approved-index
 * evidence was served from a lexical scan of the checkout. These tests pin the
 * activation contract and the fact that DISCLOSURE is rendered by the host rather
 * than requested from the model.
 */

// ── activation is an explicit control, not parsed prose ──────────────────────

test('approved-only mode is an explicit selector value', () => {
  const values = SOURCE_MODE_OPTIONS.map((o) => o.value);
  assert.deepEqual(values, ['auto', 'approved']);
  assert.equal(requiresApprovedEvidence('approved'), true);
  assert.equal(requiresApprovedEvidence('auto'), false);
});

test('approved-only is NEVER inferred from prompt text', () => {
  // The exact phrasing from the historical failure must not, by itself, arm the
  // boundary — otherwise the guarantee depends on wording.
  for (const prose of [
    'Using only the approved semantic index, identify the files and symbols…',
    'approved index only please',
    'requireApproved',
    undefined,
    '',
  ]) {
    assert.equal(requiresApprovedEvidence(prose), false, `must not arm from: ${String(prose)}`);
  }
});

test('a slash command exposes the mode without free-text parsing', () => {
  const cmd = SLASH_COMMANDS.find((c) => c.name === '/approved');
  assert.ok(cmd, '/approved must be discoverable');
  assert.deepEqual(cmd!.effect, { kind: 'shell', action: 'sourceMode:approved' }, 'a structured action, not a prompt prefix');
});

// ── disclosure is host-rendered ──────────────────────────────────────────────

test('the badge names the approved generation', () => {
  const badge = sourceModeBadge({ sourceMode: 'approved-index', indexVersion: 5, indexedBranch: 'main', currentBranch: 'main' });
  assert.equal(badge, 'Source mode: Approved index v5');
});

test('the badge discloses branch divergence', () => {
  const badge = sourceModeBadge({
    sourceMode: 'approved-index',
    indexVersion: 5,
    indexedBranch: 'phase-1/canonical-vscode-extension',
    currentBranch: 'fix/brain-approved-retrieval-grounding',
  });
  assert.match(badge, /Approved index v5/);
  assert.match(badge, /phase-1\/canonical-vscode-extension/, 'says what was indexed');
  assert.match(badge, /fix\/brain-approved-retrieval-grounding/, 'and what the checkout is');
});

test('working-tree mode is always labelled', () => {
  assert.equal(sourceModeBadge({ sourceMode: 'working-tree' }), 'Source mode: Working tree');
});

test('no decision yields no fabricated badge', () => {
  assert.equal(sourceModeBadge(undefined), '');
  assert.equal(sourceModeBadge({}), '');
});

// ── the wire contract actually carries the fields ───────────────────────────

function source(rel: string): string {
  return readFileSync(join(__dirname, '..', '..', '..', 'src', rel), 'utf8');
}

test('the transport type agrees with the Brain schema', () => {
  const client = source('services/migraAiClient.ts');
  assert.match(client, /requireApproved\?: boolean;/, 'EngineerRequest must carry requireApproved');
  assert.match(client, /currentBranch\?: string;/, 'and the checkout branch');
});

test('the engineer request is populated from the selector, not the prompt', () => {
  const engine = source('chat/chatEngine.ts');
  assert.match(engine, /requiresApprovedEvidence\(options\.sourceMode\)/, 'armed from explicit UI state');
  assert.match(engine, /requireApproved: true/);
  assert.match(engine, /currentBranch: options\.currentBranch/);
  // The prompt text must not be consulted for this decision anywhere on the path.
  assert.ok(!/requireApproved:\s*\/.*test\(/.test(engine), 'no regex over the prompt decides the mode');
});

test('the host renders provenance itself', () => {
  const turn = source('chat/engineerTurn.ts');
  assert.match(turn, /ev\.event === 'grounding'/, 'consumes the Brain decision frame');
  assert.match(turn, /sourceModeBadge\(/, 'and renders the badge deterministically');
  assert.match(turn, /ev\.event === 'refusal'/, 'and renders refusals verbatim');
  assert.match(turn, /No working-tree files were consulted/, 'refusal states what was NOT done');
});

test('the shell keeps the mode sticky on the host side', () => {
  const shell = source('panel/shell/shellProvider.ts');
  assert.match(shell, /private sourceMode = 'auto';/, 'default is auto — existing behaviour unchanged');
  assert.match(shell, /case 'sourceMode:approved':/, 'the slash action is handled');
  assert.match(shell, /private async currentBranch\(\)/, 'the branch is resolved for disclosure');
  assert.match(shell, /return undefined; \/\/ unknown, not "same"/, 'an unresolved branch stays unknown');
});
