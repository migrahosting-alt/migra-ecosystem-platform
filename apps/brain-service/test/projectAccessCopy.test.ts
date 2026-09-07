/**
 * PROJECT ACCESS IS A PLATFORM CAPABILITY, AND ITS COPY MUST SAY SO.
 *
 * ---------------------------------------------------------------------------
 * FOUND IN THE REAL PRODUCT
 *
 * A design/build request in Pilot Web refused truthfully — there was no
 * connected project — and the refusal read:
 *
 *     "workspace.inspect needs a project it can use, but no project is
 *      connected to this conversation"
 *
 * …and the remediation for a missing workspace said "Open a folder in VS Code
 * (File → Open Folder)".
 *
 * The REFUSAL was correct and must survive any fix. Two things were not:
 *
 *   1. `workspace.inspect` is an internal capability identifier from
 *      `outcomePlan.ts`. Same class as the model-picker leak already closed.
 *   2. A PLATFORM capability, in code both clients share, told a web user to
 *      install a different product. VS Code supplies richer local context —
 *      that is a client advantage, not ownership of the capability.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STEP_LABEL, type CapabilityStep } from '@migrapilot/shared-types/outcome-plan';
import {
  authorityRemedy,
  authorityShortfall,
  authoritySatisfies,
  connectedRepoAuthority,
  NO_AUTHORITY,
  platformProjectAuthority,
  vscodeWorkspaceAuthority,
} from '@migrapilot/shared-types/project-authority';

const STEPS: CapabilityStep[] = [
  'vision.read',
  'design.spec',
  'engineer.plan',
  'workspace.inspect',
  'changeset.propose',
  'verification',
  'answer',
];

/**
 * 🚨 READ THE SOURCE TREE, WHEREVER THIS RUNS FROM.
 *
 * `../src` is correct under tsx and WRONG under `npm test`, which runs the
 * compiled copy from `dist/test/` — there it resolved to `dist/src`, so the
 * guard inspected emitted JavaScript rather than the file a person edits. It
 * passed on one runner and failed on the other. Walking to the package root
 * makes it the same file either way.
 */
function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 6; up += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('package root not found from ' + fileURLToPath(import.meta.url));
}

const ROOT = packageRoot();
const src = (rel: string): string => readFileSync(join(ROOT, 'src', rel), 'utf8');

/* ------------------------------------------------------------------ *
 * No capability identifier may reach a screen
 * ------------------------------------------------------------------ */

test('every capability step has a label a person can read', () => {
  for (const step of STEPS) {
    const label = STEP_LABEL[step];
    assert.ok(label, `${step} has no user-facing label`);
    assert.doesNotMatch(label, /\./, `${JSON.stringify(label)} still looks like an identifier`);
    assert.match(label, /^[A-Z]/, `${JSON.stringify(label)} does not read as a sentence`);
  }
});

test('🚨 the refusal names the ACTION, never the capability id', () => {
  // The exact regression, at both sites that built the sentence.
  for (const file of ['engine/orchestration/decide.ts', 'engine/orchestration/outcomeDispatcher.ts']) {
    const code = src(file).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(
      code,
      /`\$\{(?:firstBlocked|step)\.step\}[^`]*needs a project/,
      `${file} interpolates the capability id into user-facing copy`,
    );
    assert.match(code, /STEP_LABEL\[/, `${file} does not use the readable label`);
  }
});

/* ------------------------------------------------------------------ *
 * Nothing in shared code may name one client
 * ------------------------------------------------------------------ */

test('🚨 the remediation does not tell a web user to install VS Code', () => {
  const code = src('engine/workspace/inspectRoutes.ts');
  /*
   * Comments STRIPPED FIRST. The comment beside this map names VS Code on
   * purpose — it records what the copy used to say and why that was wrong — and
   * a guard that cannot tell an explanation from the string a user reads would
   * force the history to be deleted to stay green.
   */
  const remediation = code
    .slice(code.indexOf('const REMEDIATION'), code.indexOf('class InspectError'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(
    remediation,
    /VS ?Code|Open Folder/i,
    'a platform capability is naming one client as the way to use it',
  );
  assert.match(remediation, /Connect a project/i, 'it must name the missing thing instead');
});

test('the shortfall sentence is client-neutral', () => {
  for (const authority of [NO_AUTHORITY, connectedRepoAuthority('r1', 'your repository')]) {
    assert.doesNotMatch(authorityShortfall(authority), /VS ?Code/i);
  }
});

/* ------------------------------------------------------------------ *
 * The web can hold a real authority now
 * ------------------------------------------------------------------ */

test('🚨 a connected project can READ — the capability the web did not have', () => {
  /*
   * Until now the only constructor granting read was vscodeWorkspaceAuthority,
   * so a web caller could hold no usable authority at all — which made project
   * access a VS Code feature in practice while the type said otherwise.
   */
  const connected = connectedRepoAuthority('repo_1', 'migrateck/ecosystem');
  assert.equal(connected.canRead, true);
  assert.equal(authoritySatisfies(connected, { read: true }), true, 'read-only inspect must be permitted');
});

test('connecting is NOT consent to change — propose and apply stay withheld', () => {
  for (const authority of [
    connectedRepoAuthority('repo_1', 'a repo'),
    platformProjectAuthority('proj_1', 'a project'),
  ]) {
    assert.equal(authority.canPropose, false);
    assert.equal(authority.canApply, false);
    assert.equal(authoritySatisfies(authority, { propose: true }), false);
    assert.equal(authoritySatisfies(authority, { apply: true }), false, 'a read-only connection must never apply');
  }
});

test('VS Code keeps its richer authority — a client advantage, not ownership', () => {
  const vscode = vscodeWorkspaceAuthority('/home/user/project');
  assert.equal(vscode.canRead, true);
  assert.equal(vscode.canPropose, true);
  // Nothing here says the extension OWNS project access; it says this
  // particular authority carries more, because local context does.
});

/* ------------------------------------------------------------------ *
 * The remedy is a code the client renders its own way
 * ------------------------------------------------------------------ */

test('a missing project asks to CONNECT, not to switch products', () => {
  assert.equal(authorityRemedy(NO_AUTHORITY), 'connect-project');
});

test('a connected read-only project asks for write access, not a connection', () => {
  assert.equal(authorityRemedy(connectedRepoAuthority('r', 'repo')), 'request-write-access');
});

test('a fully capable authority needs no remedy', () => {
  assert.equal(authorityRemedy(vscodeWorkspaceAuthority('/x')), 'none');
});
