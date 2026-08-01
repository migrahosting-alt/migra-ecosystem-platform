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

/**
 * Remove every `governedChild(...)` region, balanced-paren.
 *
 * A requiresChild callee surviving in the remainder was dispatched directly. Stripping
 * the approved regions — rather than searching for the callee NEAR a wrapper — is what
 * stops a call from passing because a governed call happens to sit a few lines above it.
 */
function withoutGovernedRegions(src: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const at = src.indexOf('governedChild(', i);
    if (at < 0) return out + src.slice(i);
    out += src.slice(i, at);
    let depth = 0;
    let j = at + 'governedChild'.length;
    for (; j < src.length; j += 1) {
      if (src[j] === '(') depth += 1;
      else if (src[j] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    i = j + 1;
  }
}

const ungoverned = withoutGovernedRegions(source);

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
  'governedChild', // the wrapper itself is the approved mechanism, not a dispatch
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


// ── enforcement: classification alone is not governance ─────────────────────

test('every requiresChild site is dispatched through governedChild, never directly', () => {
  const direct = REQUIRED_CHILD_SITES.filter((s) => {
    const bare = s.callee.split('.').pop()!;
    return new RegExp(`\\b${bare}\\s*\\(`).test(ungoverned);
  }).map((s) => `${s.id} (${s.callee})`);
  assert.deepEqual(
    direct,
    [],
    'these are classified as needing a child but are called outside governedChild:\n' +
      direct.map((d) => `  ${d}`).join('\n'),
  );
});

test('every requiresChild site id actually appears in a governedChild call', () => {
  const missing = REQUIRED_CHILD_SITES.filter((s) => !source.includes(`'${s.id}'`)).map((s) => s.id);
  assert.deepEqual(missing, [], `registered but never dispatched as a child:\n${missing.join('\n')}`);
});

test('the wrapper-stripper is not vacuous — it removes real regions', () => {
  assert.ok(source.includes('governedChild('), 'the engine must actually use the wrapper');
  assert.ok(ungoverned.length < source.length, 'stripping removed nothing');
  assert.equal(ungoverned.includes('governedChild('), false, 'all regions were removed');
});

test('no passive_local site performs network or provider work', () => {
  const NETWORKY = /fetch\(|\.chatStream\(|\.inspect\(|router\.chat\(|escalationDispatch\(/;
  for (const s of CHAT_DISPATCH_SITES.filter((x) => !x.requiresChild)) {
    assert.equal(
      NETWORKY.test(s.callee),
      false,
      `${s.id} is passive_local but its callee ${s.callee} looks like remote work`,
    );
  }
});
