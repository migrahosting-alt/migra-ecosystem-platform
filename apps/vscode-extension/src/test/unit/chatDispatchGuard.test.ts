// Structural guard: a new dispatch inside the chat turn cannot be added silently.
//
// The failure this prevents: someone adds a provider or tool call to chatEngine, it
// works, it ships — and it is not a child of any turn, so an interruption leaves no
// record that work was sent. Same shape as the Brain-fetch guard.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CHAT_DISPATCH_SITES,
  REQUIRED_CHILD_SITES,
} from '../../services/chatDispatchRegistry.js';

const ENGINE = join(__dirname, '..', '..', '..', 'src', 'chat', 'chatEngine.ts');
const source = readFileSync(ENGINE, 'utf8');

/** Awaited calls and for-await iterations — the shapes that can outlive the loop. */
const DISPATCH_SHAPES = [
  /await\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g,
  /for\s+await\s*\(\s*const\s+\w+\s+of\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g,
];

/** Calls that are plainly not dispatches: local helpers, the turn machinery itself,
 * and control flow. Listed rather than pattern-matched so each exemption is visible. */
const NOT_A_DISPATCH = new Set([
  'runChatTurnInner', 'ChatTurnExecution.begin', 'turn.finish', 'turn.requestCancellation',
  'turn.registerChild', 'this.ensureConversation', 'renderRoutingError', 'sink.markdown',
  'sink.progress', 'resolveWorkspaceRootForTask', 'ensureAgentAuthorization',
  'vscode.workspace.openTextDocument', 'vscode.window.showTextDocument',
  'vscode.window.showWarningMessage', 'vscode.window.showInformationMessage',
  'Promise.all', 'Promise.race', 'JSON.parse',
]);

function calleesInSource(): Set<string> {
  const found = new Set<string>();
  for (const re of DISPATCH_SHAPES) {
    for (const m of source.matchAll(re)) {
      const callee = m[1]!;
      if (NOT_A_DISPATCH.has(callee)) continue;
      found.add(callee);
    }
  }
  return found;
}

/** Registry callees, matched by suffix so `deps.migraAiClient.inspect` matches
 * `migraAiClient.inspect`. */
function isRegistered(callee: string): boolean {
  return CHAT_DISPATCH_SITES.some((s) => callee === s.callee || callee.endsWith(`.${s.callee}`) || s.callee.endsWith(`.${callee.split('.').slice(-2).join('.')}`));
}

test('every dispatch-shaped call in chatEngine has an explicit governance classification', () => {
  const unclassified = [...calleesInSource()].filter((c) => !isRegistered(c)).sort();
  assert.deepEqual(
    unclassified,
    [],
    'these calls are not in CHAT_DISPATCH_SITES — decide whether each needs child governance:\n' +
      unclassified.map((c) => `  ${c}`).join('\n') +
      '\n(if it is genuinely local, add it with requiresChild: false and a rationale)',
  );
});

test('the guard is not vacuous — it finds the known dispatch sites in source', () => {
  const found = calleesInSource();
  const seen = CHAT_DISPATCH_SITES.filter((s) =>
    [...found].some((c) => c === s.callee || c.endsWith(`.${s.callee}`)),
  );
  assert.ok(seen.length >= 6, `expected to locate the known sites, matched ${seen.length}`);
});

test('every registry entry carries a rationale, and required children are a real subset', () => {
  for (const s of CHAT_DISPATCH_SITES) {
    assert.ok(s.rationale.length > 20, `${s.id} needs a real rationale`);
    assert.ok(s.id && s.callee, `${s.id} is incomplete`);
  }
  assert.ok(REQUIRED_CHILD_SITES.length > 0, 'some dispatches must require children');
  assert.ok(
    REQUIRED_CHILD_SITES.length < CHAT_DISPATCH_SITES.length,
    'not every call is a child — a registry that says "all" has not made a decision',
  );
});

test('passive_local is the only classification allowed to skip child governance', () => {
  const skipping = CHAT_DISPATCH_SITES.filter((s) => !s.requiresChild);
  for (const s of skipping) {
    assert.equal(
      s.classification,
      'passive_local',
      `${s.id} skips governance but is classified ${s.classification} — remote work needs a record`,
    );
  }
});
