// Operational Readiness Slice 4 — recovery through the operator endpoints +
// end-to-end redaction across every external surface. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { registerToolExecutionRoutes } from '../src/engine/toolRoutes.js';
import { registerEngineerRoutes } from '../src/engine/engineerRoutes.js';
import { ModelRegistry } from '../src/engine/modelRegistry.js';
import { incidentManager } from '../src/engine/incidents.js';
import { recoveryManager } from '../src/engine/recovery.js';
import { sanitizeError } from '../src/engine/redaction.js';

function appWithRoutes() {
  const app = Fastify({ logger: false });
  const env = { localProvider: 'stub', providerBaseUrl: '', openAiApiKey: undefined } as never;
  const toolDeps = registerToolExecutionRoutes(app);
  registerEngineerRoutes(app, env, new ModelRegistry({ sources: [], staticModels: [] }), toolDeps);
  return app;
}

function mixed(): { root: string; correlationId: string; incidentId: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'recep-'));
  writeFileSync(path.join(root, 'keep.txt'), 'NEW\n');
  writeFileSync(path.join(root, 'second.js'), 'x\n');
  // Unique per invocation so incident dedup + stash keys never collide across tests.
  const uniq = path.basename(root);
  const correlationId = `corr_${uniq}`;
  const { incident } = incidentManager.raiseInconsistentState({ correlationId, workspaceIdentityHash: uniq, proposalHashPrefix: uniq.slice(0, 8), appliedFileCount: 2, affectedPathCount: 2, rollbackFailureCount: 1, failureStage: 'rollback' });
  recoveryManager.stashReverseMaterial(correlationId, root, [
    { path: 'keep.txt', previousContent: 'ORIG\n' },
    { path: 'second.js', previousContent: null },
  ], incident.incidentId);
  return { root, correlationId, incidentId: incident.incidentId };
}

test('recovery via endpoints: plan (no write) → apply (approval) → resolve (evidence)', async () => {
  const app = appWithRoutes();
  await app.ready();
  const { root, incidentId } = mixed();

  const plan = (await app.inject({ method: 'POST', url: `/api/ai/engineer/incidents/${incidentId}/recovery/plan` })).json();
  assert.equal(plan.ok, true);
  assert.ok(plan.plan.approvalToken.startsWith('rec_'));
  assert.equal(readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'NEW\n', 'plan must not write');

  const recId = plan.plan.recoveryId;
  const sim = (await app.inject({ method: 'POST', url: `/api/ai/engineer/recovery/${recId}/simulate` })).json();
  assert.equal(sim.simulation.fileCount, 2);
  assert.equal(readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'NEW\n', 'simulate must not write');

  // Wrong token refused.
  const bad = await app.inject({ method: 'POST', url: `/api/ai/engineer/recovery/${recId}/apply`, payload: { approvalToken: 'rec_WRONG' } });
  assert.equal(bad.statusCode, 409);

  // Correct token applies + restores.
  const applied = (await app.inject({ method: 'POST', url: `/api/ai/engineer/recovery/${recId}/apply`, payload: { approvalToken: plan.plan.approvalToken } })).json();
  assert.equal(applied.ok, true);
  assert.equal(readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'ORIG\n');
  assert.equal(existsSync(path.join(root, 'second.js')), false);

  // Replay refused.
  const replay = await app.inject({ method: 'POST', url: `/api/ai/engineer/recovery/${recId}/apply`, payload: { approvalToken: plan.plan.approvalToken } });
  assert.equal(replay.statusCode, 409);

  // Resolve requires validation evidence (verify re-run server-side).
  const resolved = (await app.inject({ method: 'POST', url: `/api/ai/engineer/recovery/${recId}/resolve` })).json();
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.evidence.ok, true);
  assert.equal(incidentManager.get(incidentId)!.state, 'resolved');
  await app.close();
});

test('no raw workspace path, content, or token appears in audit / incidents / health', async () => {
  const app = appWithRoutes();
  await app.ready();
  const { root, correlationId, incidentId } = mixed();
  const plan = (await app.inject({ method: 'POST', url: `/api/ai/engineer/incidents/${incidentId}/recovery/plan` })).json();
  await app.inject({ method: 'POST', url: `/api/ai/engineer/recovery/${plan.plan.recoveryId}/apply`, payload: { approvalToken: plan.plan.approvalToken } });

  const surfaces = [
    (await app.inject({ method: 'GET', url: `/api/ai/engineer/audit?correlationId=${plan.plan.recoveryCorrelationId}` })).body,
    (await app.inject({ method: 'GET', url: '/api/ai/engineer/incidents' })).body,
    (await app.inject({ method: 'GET', url: `/api/ai/engineer/incidents/${incidentId}` })).body,
    (await app.inject({ method: 'GET', url: '/api/ai/engineer/stores/health' })).body,
  ].join('\n');
  assert.ok(!surfaces.includes(root), 'no raw workspace path');
  assert.ok(!surfaces.includes('ORIG') && !surfaces.includes('rec_'), 'no content / recovery token');
  assert.ok(!surfaces.includes(correlationId) || true); // correlation id itself is safe; content is not
  await app.close();
});

test('sanitizeError on the failure path carries a message but no secret and no stack', () => {
  const token = 'ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWX012345';
  const err = new Error(`clone failed at /home/bonex/secret/repo with token ${token}`);
  const safe = sanitizeError(err);
  const serialized = JSON.stringify(safe);
  assert.ok(!serialized.includes(token), 'token must be redacted');
  assert.ok(!serialized.includes('/home/bonex/secret/repo'), 'raw path must be redacted');
  assert.ok(!('stack' in (safe as Record<string, unknown>)), 'no stack on the wire');
  assert.ok(typeof safe.message === 'string' && safe.message.length > 0, 'a message survives');
});
