import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  SLASH_COMMANDS,
  SOURCE_MODE_OPTIONS,
  groundingModeOf,
  isGovernedMode,
  requiresApprovedEvidence,
  sourceModeBadge,
  sourceModeConfirmation,
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

test('the selector exposes all four protocol modes, mapped exactly', () => {
  // Labels and wire values must not drift: the UI stores the PROTOCOL value, so a
  // label change can never silently alter what the Brain is asked to enforce.
  assert.deepEqual(SOURCE_MODE_OPTIONS.map((o) => o.value), ['auto', 'approved', 'workspace', 'none']);
  assert.deepEqual(SOURCE_MODE_OPTIONS.map((o) => o.label), [
    'Auto evidence',
    'Approved index',
    'Current workspace',
    'No repository evidence',
  ]);
  assert.equal(requiresApprovedEvidence('approved'), true);
  assert.equal(requiresApprovedEvidence('auto'), false);
});

test('every mode except auto is marked as a governance state', () => {
  const governed = SOURCE_MODE_OPTIONS.filter((o) => o.governed).map((o) => o.value);
  assert.deepEqual(governed, ['approved', 'workspace', 'none'], 'auto makes no governance claim');
  for (const mode of ['approved', 'workspace', 'none']) assert.equal(isGovernedMode(mode), true);
  assert.equal(isGovernedMode('auto'), false);
});

test('an unrecognised mode degrades to auto, never to a governance claim', () => {
  for (const bad of ['APPROVED', 'workspace ', 'strict', '', undefined]) {
    assert.equal(groundingModeOf(bad), 'auto', `must not honour ${String(bad)}`);
  }
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

test('every effective source mode is labelled', () => {
  assert.equal(sourceModeBadge({ sourceMode: 'working-tree' }), 'Source mode: Current workspace');
  assert.equal(sourceModeBadge({ sourceMode: 'none' }), 'Source mode: No repository evidence');
  // A FALLBACK reads differently from a deliberate choice — the operator did not
  // pick the checkout, `auto` landed there.
  assert.equal(
    sourceModeBadge({ sourceMode: 'working-tree', requestedMode: 'auto', forced: false }),
    'Source mode: Working tree (no approved evidence matched)',
  );
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

test('the selector is RENDERED, not just defined', () => {
  // It was defined and never rendered once: the bundler tree-shook the labels out
  // and the only way to arm the mode was `/approved`. An operator could not see
  // which evidence source the next turn was held to.
  const html = source('panel/shell/shellHtml.ts');
  assert.match(html, /SOURCE_MODE_OPTIONS/, 'the options must reach the markup');
  assert.match(html, /id="csource"/, 'a real select element');

  const composer = source('panel/shell/script/composer.ts');
  assert.match(composer, /sourceMode: \(\$\('csource'\)/, 'and its value must be sent with the turn');
  assert.match(composer, /case 'sourceMode':/, 'host-set modes are reflected back into it');
});

test('both composer selects share one style rule and are distinguishable', () => {
  const styles = source('panel/shell/shellStyles.ts');
  // The evidence selector rendered as a NATIVE WHITE control because the rule was
  // written for a single id. Both must be covered by the same declaration.
  assert.match(styles, /#croute,\s*#csource\s*\{/, 'one shared rule, not per-id styling');
  assert.match(styles, /appearance: none/, 'platform chrome suppressed so it matches the shell');
  // All three governance modes get the deliberate treatment, not just approved.
  for (const mode of ['approved', 'workspace', 'none']) {
    assert.match(styles, new RegExp(`#csource\\[data-mode="${mode}"\\]`), `${mode} reads as a governance state`);
  }

  // Collapsed, each control must say what it selects.
  assert.equal(SOURCE_MODE_OPTIONS.length, 4);
  assert.ok(
    SOURCE_MODE_OPTIONS.every((o) => o.hint.length > 20),
    'each option carries a tooltip explaining what it does',
  );
});

// ── transport: the Brain must receive the EXACT requested mode ────────────────

test('each mode reaches the wire unchanged, and auto stays off the wire', () => {
  const engine = source('chat/chatEngine.ts');
  // `auto` is omitted so the payload for existing callers is byte-identical to
  // before this slice — a new field appearing on every request would be a silent
  // behaviour change for older Brains.
  assert.match(engine, /groundingModeOf\(options\.sourceMode\) !== 'auto'/, 'auto is not sent');
  assert.match(engine, /groundingMode: groundingModeOf\(options\.sourceMode\)/, 'the mode is sent verbatim');
  // The legacy alias rides along for Brains that predate the mode.
  assert.match(engine, /requireApproved: true/, 'approved still sets the legacy flag');
});

test('the transport type uses the SHARED protocol union', () => {
  const client = source('services/migraAiClient.ts');
  assert.match(client, /groundingMode\?: GroundingMode;/, 'field present');
  assert.match(client, /from '@migrapilot\/protocol'/, 'and typed from the shared package');
  // A second local union would let the UI offer a mode the Brain never enforces.
  assert.ok(!/type GroundingMode\s*=\s*'/.test(client), 'must not redeclare the union locally');
});

test('the protocol package is the single definition of the mode set', () => {
  const protocolPath = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'protocol', 'src', 'grounding.ts');
  const protocol = readFileSync(protocolPath, 'utf8');
  assert.match(protocol, /GROUNDING_MODES = \['auto', 'approved', 'workspace', 'none'\]/);
  // The UI's values must be exactly the protocol's values, in order.
  const uiValues = SOURCE_MODE_OPTIONS.map((o) => o.value).join(',');
  assert.equal(uiValues, 'auto,approved,workspace,none', 'UI order matches the protocol order');
});

test('the confirmation states what each mode ENFORCES', () => {
  assert.match(sourceModeConfirmation('approved'), /refused rather than answered from working-tree/i);
  assert.match(sourceModeConfirmation('workspace'), /approved index is not consulted/i);
  assert.match(sourceModeConfirmation('workspace'), /not reviewed evidence/i);
  assert.match(sourceModeConfirmation('none'), /will not be read at all/i);
  assert.match(sourceModeConfirmation('none'), /tools are withheld/i);
  assert.match(sourceModeConfirmation('auto'), /source of each answer is stated/i);
  // An operator who cannot describe the control back cannot rely on it.
  for (const mode of ['auto', 'approved', 'workspace', 'none']) {
    assert.ok(sourceModeConfirmation(mode).length > 60, `${mode}: says what it does`);
  }
});

test('the composer reflects a governance selection immediately', () => {
  const composer = source('panel/shell/script/composer.ts');
  // Without this the operator picked "No repository evidence" and the control still
  // looked neutral until the next turn.
  assert.match(composer, /csource\.addEventListener\('change'/, 'selection is observed');
  assert.match(composer, /setAttribute\('data-mode', csource\.value\)/, 'and reflected onto the element');
  assert.match(composer, /'sourceMode:' \+ csource\.value/, 'and pushed to the host so it sticks');
});

test('all four modes are reachable by slash command', () => {
  const actions = SLASH_COMMANDS.filter((c) => c.effect.kind === 'shell' && c.effect.action.startsWith('sourceMode:'))
    .map((c) => (c.effect as { action: string }).action);
  assert.deepEqual(actions.sort(), ['sourceMode:approved', 'sourceMode:none', 'sourceMode:workspace']);
  // `auto` needs no command: it is the default the selector starts in.
});
