import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/** This package's root, whether running from `test/` (tsx) or `dist/test/` (CI). */
function packageRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return here.endsWith(path.join('dist', 'test')) ? path.resolve(here, '../..') : path.resolve(here, '..');
}

import {
  ToolGate,
  ToolGateNotOpenError,
  ToolNotPermittedError,
  classifyTool,
  permittedTools,
  toolAuthoritySummary,
} from '../src/engine/capability/capabilityTools.js';
import { resolveCapability, DEEP_LOCAL_MODEL, FAST_LOCAL_MODEL } from '../src/engine/capability/capabilityGrants.js';
import {
  GATEWAY_PRINCIPAL_HEADER,
  GATEWAY_SECRET_HEADER,
  NEVER_TRUSTED_INPUT_FIELDS,
  localOperatorId,
  resolveOperatorPrincipal,
} from '../src/engine/capability/operatorPrincipal.js';
import { permittedToolClasses, principalAuditFields, principalIsTrusted } from '@migrapilot/protocol';

/**
 * Enforcement, not advertisement.
 *
 * The engineer loop already narrowed the tool list it showed the model, and that was never
 * a boundary: `executeToolCore` validates that a tool exists, is available and is approved,
 * but it never checked the tool against what this turn was actually shown. A model naming an
 * unadvertised tool reached the executor regardless.
 *
 * So these tests care about the gate, and about the one property that makes the gate
 * trustworthy — that it cannot answer before authority is known.
 */

const CANDIDATES = [
  { id: 'fs.read', readOnly: true },
  { id: 'search.grep', readOnly: true },
  { id: 'plan.update', readOnly: true },
  { id: 'fs.write', readOnly: false },
  { id: 'edit.apply', readOnly: false },
  { id: 'changeset.approve', readOnly: false },
  { id: 'deploy.run', readOnly: false },
];

const gateFor = (taskClass: string | undefined, model = DEEP_LOCAL_MODEL) =>
  new ToolGate().open(resolveCapability({ taskClass, model }));

// ── the ordering invariant, structurally ─────────────────────────────────────

test('the gate REFUSES TO ANSWER before authority is resolved', () => {
  const sealed = new ToolGate();
  assert.equal(sealed.isOpen, false);
  // Sealed-by-default is the design. Returning true would make the invariant depend on
  // nobody reordering two lines; returning false would silently strip every tool and look
  // like a model that chose not to use any. Throwing is the only outcome that cannot be
  // mistaken for correct behaviour.
  assert.throws(() => sealed.permit('fs.read', true), ToolGateNotOpenError);
  assert.throws(() => sealed.assertPermitted('fs.read', true), ToolGateNotOpenError);
  assert.throws(() => sealed.authority, ToolGateNotOpenError);
  assert.throws(() => permittedTools(sealed, CANDIDATES), /before capability authority was resolved/);
});

test('the real route routes BOTH tool paths through the gate', () => {
  // The primary guarantee is the seal above: a sealed gate throws, so a route that derived
  // tools before resolving authority could not complete a single turn — and the route suite
  // proves turns complete. This test adds the complementary half, that both the advertised
  // list and the execution check go through the SAME gate rather than one of them bypassing
  // it, which a runtime test cannot show on its own.
  // Derive the package root instead of counting `..` segments. `import.meta.url`
  // is `test/` under tsx and `dist/test/` after a build, so the fixed `../../src`
  // this used resolved correctly ONLY in the compiled layout — which is how CI
  // runs it. Locally it pointed at `apps/src/...` and the test failed with ENOENT
  // for a file that was never missing, so the check looked broken on every
  // developer machine and green in CI.
  const text = readFileSync(path.join(packageRoot(), 'src/engine/engineerRoutes.ts'), 'utf8');
  const opened = text.indexOf('new ToolGate().open(capability)');
  const advertised = text.indexOf('permittedTools(toolGate,');
  const executed = text.indexOf('toolGate.assertPermitted(');
  assert.ok(opened > 0 && advertised > 0 && executed > 0, 'the route must use the gate for both paths');
  assert.ok(opened < advertised, 'the gate is opened before tools are derived');
  assert.ok(opened < executed, 'the gate is opened before any tool executes');
  // And the decision itself precedes the gate.
  assert.ok(text.indexOf('resolveCapability({ taskClass: body.taskClass') < opened);
});

// ── classification by consequence, not by name ───────────────────────────────

test('tools are classified by consequence, and an unknown writer defaults to mutation', () => {
  assert.equal(classifyTool('fs.read', true), 'read-only');
  assert.equal(classifyTool('fs.write', false), 'mutation');
  assert.equal(classifyTool('changeset.approve', false), 'approval');
  assert.equal(classifyTool('deploy.run', false), 'production');
  // Pattern-matched, so a newly registered tool falls into a class rather than escaping an
  // id allowlist nobody remembered to update.
  assert.equal(classifyTool('release.publish', false), 'production');
  assert.equal(classifyTool('deploy.anything-new', false), 'production');
  assert.equal(classifyTool('review.certify', false), 'approval');
  assert.equal(classifyTool('brand.new.writer', false), 'mutation', 'unknown writers are cautious, not free');
});

// ── the four authorities ─────────────────────────────────────────────────────

test('autonomous may read and mutate, but not approve or deploy', () => {
  assert.deepEqual([...permittedToolClasses('autonomous')], ['read-only', 'mutation']);
  const gate = gateFor('typed-implementation');
  assert.equal(gate.authority, 'autonomous');
  const allowed = permittedTools(gate, CANDIDATES).map((t) => t.id);
  assert.deepEqual(allowed, ['fs.read', 'search.grep', 'plan.update', 'fs.write', 'edit.apply']);
  // Being trusted to write a file is not being trusted to ship it.
  assert.ok(!allowed.includes('changeset.approve'));
  assert.ok(!allowed.includes('deploy.run'));
});

test('advisory receives NO mutation-capable tools', () => {
  assert.deepEqual([...permittedToolClasses('advisory')], ['read-only']);
  const gate = gateFor('repository-diagnosis');
  assert.equal(gate.authority, 'advisory', 'the deep model diagnoses advisorily — score was read, not executed');
  const allowed = permittedTools(gate, CANDIDATES).map((t) => t.id);
  // It can inspect, explain, and propose — a proposal is read-only work that changes
  // nothing and produces a reviewable artifact.
  assert.deepEqual(allowed, ['fs.read', 'search.grep', 'plan.update']);
  for (const denied of ['fs.write', 'edit.apply', 'changeset.approve', 'deploy.run']) {
    assert.throws(() => gate.assertPermitted(denied, false), ToolNotPermittedError, `${denied} must be refused`);
  }
});

test('denied exposes ZERO tools of any class', () => {
  assert.deepEqual([...permittedToolClasses('denied')], []);
  const gate = gateFor('security-review');
  assert.equal(gate.authority, 'denied');
  assert.deepEqual(permittedTools(gate, CANDIDATES), [], 'not even a read');
  assert.throws(() => gate.assertPermitted('fs.read', true), ToolNotPermittedError);
});

test('ungoverned may inspect but cannot mutate until a class is declared', () => {
  assert.deepEqual([...permittedToolClasses('ungoverned')], ['read-only']);
  const gate = gateFor(undefined);
  assert.equal(gate.authority, 'ungoverned');
  const allowed = permittedTools(gate, CANDIDATES).map((t) => t.id);
  // Ordinary conversation and inspection keep working — every request written before the
  // field existed omits it — but a consequential action needs a declared class.
  assert.deepEqual(allowed, ['fs.read', 'search.grep', 'plan.update']);
  assert.throws(() => gate.assertPermitted('fs.write', false), ToolNotPermittedError);
  assert.throws(() => gate.assertPermitted('deploy.run', false), ToolNotPermittedError);
});

test('a malformed task class cannot widen authority', () => {
  // It degrades to `unclassified` → `ungoverned`, which is read-only — never to the
  // authority of the class it superficially resembles.
  for (const bad of ['TYPED-IMPLEMENTATION', 'typed_implementation', 'autonomous', '../typed-implementation']) {
    const gate = gateFor(bad);
    assert.equal(gate.authority, 'ungoverned', `${bad} must not become a family`);
    assert.throws(() => gate.assertPermitted('fs.write', false), ToolNotPermittedError);
  }
});

test('an unknown model fails closed even on a low-risk class', () => {
  const gate = gateFor('typed-implementation', 'mystery-model:400b');
  // No grant exists for it, so no authority — a big number in the name earns nothing.
  assert.equal(gate.authority, 'denied');
  assert.deepEqual(permittedTools(gate, CANDIDATES), []);
});

test('the refusal names the tool, its class and the authority that refused it', () => {
  const gate = gateFor('repository-diagnosis');
  try {
    gate.assertPermitted('deploy.run', false);
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof ToolNotPermittedError);
    assert.equal(err.toolId, 'deploy.run');
    assert.equal(err.toolClass, 'production');
    assert.equal(err.authority, 'advisory');
    assert.match(err.message, /CAPABILITY_TOOL_DENIED/);
  }
});

test('the audit summary counts classes and never leaks the tool ids of a turn', () => {
  const summary = toolAuthoritySummary(CANDIDATES);
  assert.deepEqual(summary, { 'read-only': 3, mutation: 2, approval: 1, production: 1 });
  assert.ok(!JSON.stringify(summary).includes('fs.write'));
});

// ── operator principal: derived, never claimed ───────────────────────────────

const hostIdentity = () => ({ uid: 1001, user: 'bonex', host: 'workstation' });
const fixedSession = () => 'session-fixed';

test('the local principal is DERIVED from the process, and is stable and opaque', () => {
  const p = resolveOperatorPrincipal({ hostIdentity, newSessionId: fixedSession });
  assert.equal(p.authenticationMethod, 'vscode-host');
  assert.equal(p.tenantId, 'local');
  assert.match(p.operatorId, /^local:[0-9a-f]{16}$/);
  // Stable across calls, and carrying neither username nor hostname.
  assert.equal(p.operatorId, resolveOperatorPrincipal({ hostIdentity, newSessionId: fixedSession }).operatorId);
  assert.ok(!p.operatorId.includes('bonex'));
  assert.ok(!p.operatorId.includes('workstation'));
  assert.equal(principalIsTrusted(p), true);
  // A different user is a different identity.
  assert.notEqual(localOperatorId(hostIdentity()), localOperatorId({ uid: 1002, user: 'other', host: 'workstation' }));
});

test('a request CANNOT supply its own principal', () => {
  // The failure being closed: an override audit that read the id from the request would
  // record whatever the requester typed, so a model asking to bypass a denial could also
  // sign the bypass. That record would look like accountability and contain none.
  const spoofed = Object.fromEntries(NEVER_TRUSTED_INPUT_FIELDS.map((f) => [f, 'attacker']));
  const p = resolveOperatorPrincipal({
    headers: spoofed as Record<string, string>,
    hostIdentity,
    newSessionId: fixedSession,
  });
  assert.equal(p.operatorId, localOperatorId(hostIdentity()), 'the derived identity wins');
  assert.equal(p.authenticationMethod, 'vscode-host');
  assert.ok(!JSON.stringify(p).includes('attacker'));
});

test('a gateway assertion WITHOUT the secret is discarded, not treated as a hint', () => {
  const assertion = JSON.stringify({ operatorId: 'admin:root', tenantId: 'prod', roles: ['admin'] });
  const p = resolveOperatorPrincipal({
    headers: { [GATEWAY_PRINCIPAL_HEADER]: assertion },
    env: { MIGRAPILOT_GATEWAY_SECRET: 'correct-secret' },
    hostIdentity,
    newSessionId: fixedSession,
  });
  // Anonymous rather than local: a caller DID try to assert an identity, and quietly
  // substituting the host one would hide the attempt.
  assert.equal(p.authenticationMethod, 'unauthenticated');
  assert.equal(principalIsTrusted(p), false);
  assert.ok(!JSON.stringify(p).includes('admin:root'));
});

test('a gateway assertion with the WRONG secret is discarded', () => {
  const p = resolveOperatorPrincipal({
    headers: {
      [GATEWAY_PRINCIPAL_HEADER]: JSON.stringify({ operatorId: 'admin:root', tenantId: 'prod' }),
      [GATEWAY_SECRET_HEADER]: 'guessed',
    },
    env: { MIGRAPILOT_GATEWAY_SECRET: 'correct-secret' },
    hostIdentity,
    newSessionId: fixedSession,
  });
  assert.equal(p.authenticationMethod, 'unauthenticated');
  assert.ok(!JSON.stringify(p).includes('admin:root'));
});

test('a gateway assertion with the right secret is honoured, but cannot claim vscode-host', () => {
  const p = resolveOperatorPrincipal({
    headers: {
      [GATEWAY_PRINCIPAL_HEADER]: JSON.stringify({
        operatorId: 'user:42', tenantId: 'acme', roles: ['operator'], authenticationMethod: 'vscode-host',
      }),
      [GATEWAY_SECRET_HEADER]: 'correct-secret',
    },
    env: { MIGRAPILOT_GATEWAY_SECRET: 'correct-secret' },
    hostIdentity,
    newSessionId: fixedSession,
  });
  assert.equal(p.operatorId, 'user:42');
  assert.equal(p.tenantId, 'acme');
  // `vscode-host` means "derived from this process". A remote assertion of it would be a
  // lie about HOW the identity was obtained, so it is downgraded rather than believed.
  assert.equal(p.authenticationMethod, 'gateway');
});

test('a malformed gateway assertion is anonymous, never partially trusted', () => {
  for (const bad of ['not-json', '{}', JSON.stringify({ operatorId: 'x' }), JSON.stringify({ tenantId: 'y' }), '[]']) {
    const p = resolveOperatorPrincipal({
      headers: { [GATEWAY_PRINCIPAL_HEADER]: bad, [GATEWAY_SECRET_HEADER]: 's' },
      env: { MIGRAPILOT_GATEWAY_SECRET: 's' },
      hostIdentity,
      newSessionId: fixedSession,
    });
    assert.equal(p.authenticationMethod, 'unauthenticated', `must not partially trust: ${bad}`);
  }
});

test('the principal audit carries identity, not the display name', () => {
  const fields = principalAuditFields({
    operatorId: 'local:abc123', tenantId: 'local', authenticationMethod: 'vscode-host',
    sessionId: 's1', roles: ['operator'], displayName: 'Bonex Petit-Frere',
  });
  assert.equal(fields.operatorId, 'local:abc123');
  assert.equal(fields.principalTrusted, true);
  // Names are mutable, non-unique and locale-dependent; an audit trail that keys on one
  // cannot survive a rename, so it is not recorded at all.
  assert.ok(!JSON.stringify(fields).includes('Bonex'));
  for (const [k, v] of Object.entries(fields)) {
    const flat = ['string', 'number', 'boolean'].includes(typeof v) || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
    assert.ok(flat, `${k} must be flat for the audit store`);
  }
});

test('an unauthenticated principal is never trusted for a governance decision', () => {
  const p = resolveOperatorPrincipal({
    headers: { [GATEWAY_PRINCIPAL_HEADER]: 'garbage', [GATEWAY_SECRET_HEADER]: 's' },
    env: { MIGRAPILOT_GATEWAY_SECRET: 's' },
    hostIdentity,
    newSessionId: fixedSession,
  });
  assert.equal(principalIsTrusted(p), false);
  // An override recorded against this would name nobody — worse than refusing it, because
  // the record would look like accountability.
  assert.equal(principalAuditFields(p).operatorId, '(none)');
});
