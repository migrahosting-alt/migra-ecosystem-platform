import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { CapabilityRegistry } from '../src/engine/capabilityRegistry.js';
import { ToolApprovalStore, hashInput } from '../src/engine/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/toolAudit.js';
import { registerToolExecutionRoutes } from '../src/engine/toolRoutes.js';

function buildApp(overrides?: {
  approvals?: ToolApprovalStore;
  audit?: ToolAudit;
  registry?: CapabilityRegistry;
}): { app: FastifyInstance; audit: ToolAudit } {
  const app = Fastify();
  const audit = overrides?.audit ?? new ToolAudit();
  registerToolExecutionRoutes(app, { registry: overrides?.registry, approvals: overrides?.approvals, audit });
  return { app, audit };
}

// A registry whose edit.apply/edit.preview are swapped for in-memory fakes so
// approval / dry-run / replay semantics are tested without touching the FS.
class FakeRegistry extends CapabilityRegistry {
  applied: unknown[] = [];
  override runnable(id: string) {
    const base = super.runnable(id);
    if (id === 'edit.apply' && base) {
      return {
        ...base,
        handler: async (input: unknown) => {
          this.applied.push(input);
          return { files: [{ path: 'x.ts', changed: true }] };
        },
        preview: async () => ({ files: [{ path: 'x.ts', before: 'a', after: 'b' }] }),
      };
    }
    return base;
  }
}

const EDIT_INPUT = { rootPath: '/tmp/x', changes: [{ path: 'x.ts', startLine: 1, endLine: 1, replacement: 'const a = 1;' }] };

test('registry discovery lists available tools with metadata, hides ungranted', () => {
  const reg = new CapabilityRegistry();
  const ids = reg.list().map((t) => t.id);
  assert.ok(ids.includes('git.diff'));
  assert.ok(ids.includes('edit.apply'));
  assert.ok(!ids.includes('terminal.exec'), 'ungranted capability not listed by default');
  const editApply = reg.list().find((t) => t.id === 'edit.apply')!;
  assert.equal(editApply.readOnly, false);
  assert.equal(editApply.approvalRequired, true);
  assert.equal(editApply.supportsDryRun, true);
  assert.equal(typeof editApply.inputSchemaVersion, 'number');
});

test('capability filtering by readOnly / category / includeUnavailable', () => {
  const reg = new CapabilityRegistry();
  assert.ok(reg.list({ readOnly: true }).every((t) => t.readOnly));
  assert.ok(reg.list({ readOnly: false }).every((t) => !t.readOnly));
  assert.ok(reg.list({ category: 'git' }).every((t) => t.category === 'git'));
  assert.ok(reg.list({ includeUnavailable: true }).some((t) => t.id === 'terminal.exec'));
});

test('GET /api/ai/tools + /:id expose sanitized metadata only', async () => {
  const { app } = buildApp();
  const list = await app.inject({ method: 'GET', url: '/api/ai/tools' });
  assert.equal(list.statusCode, 200);
  const body = list.json() as { count: number; tools: Array<Record<string, unknown>> };
  assert.ok(body.count >= 6);
  assert.ok(!('handler' in body.tools[0]!) && !('inputSchema' in body.tools[0]!));
  assert.equal((await app.inject({ method: 'GET', url: '/api/ai/tools/git.diff' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/ai/tools/nope' })).statusCode, 404);
  await app.close();
});

test('read-only execution runs immediately + propagates correlation', async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/ai/tools',
    headers: { 'x-request-id': 'req-abc' },
    payload: { tool: 'git.status', input: { rootPath: process.cwd() } },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { ok: boolean; status: string; result: unknown; requestId: string };
  assert.equal(body.status, 'ok');
  assert.equal(body.requestId, 'req-abc');
  assert.ok(body.result);
  await app.close();
});

test('unknown tool → 404 UNKNOWN_TOOL', async () => {
  const { app } = buildApp();
  const res = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'does.not.exist', input: {} } });
  assert.equal(res.statusCode, 404);
  assert.equal((res.json() as { code: string }).code, 'UNKNOWN_TOOL');
  await app.close();
});

test('denied capability (ungranted) → 403 CAPABILITY_DENIED', async () => {
  const { app } = buildApp();
  const res = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'terminal.exec', input: EDIT_INPUT } });
  assert.equal(res.statusCode, 403);
  assert.equal((res.json() as { code: string }).code, 'CAPABILITY_DENIED');
  await app.close();
});

test('generic route cannot list, mint, resume, or execute command capabilities', async () => {
  const { app, audit } = buildApp();
  const catalog = (await app.inject({ method: 'GET', url: '/api/ai/tools' })).json() as { tools: Array<{ id: string }> };
  assert.equal(catalog.tools.some((tool) => tool.id === 'command.run' || tool.id === 'agent.recipe'), false);
  const attempt = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'command.run', input: { rootPath: process.cwd(), command: ['node', '--version'] } } });
  assert.equal(attempt.statusCode, 403);
  assert.equal((attempt.json() as { code: string }).code, 'CAPABILITY_DENIED');
  const resume = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'agent.recipe', input: {}, approvalId: 'appr_attacker' } });
  assert.equal(resume.statusCode, 403);
  assert.equal(audit.recent().some((event) => event.action === 'approval_required' || event.action === 'executed'), false);
  await app.close();
});

test('schema validation: bad input → 400 INVALID_INPUT with issues', async () => {
  const { app } = buildApp();
  const res = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'git.diff', input: { staged: 'not-a-bool' } } });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { code: string; issues: unknown[] };
  assert.equal(body.code, 'INVALID_INPUT');
  assert.ok(Array.isArray(body.issues));
  await app.close();
});

test('mutating dry-run returns a preview and never executes', async () => {
  const reg = new FakeRegistry();
  const { app } = buildApp({ registry: reg });
  const res = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'edit.apply', input: EDIT_INPUT, dryRun: true } });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as { status: string }).status, 'dry_run');
  assert.equal(reg.applied.length, 0, 'dry-run must not mutate');
  await app.close();
});

test('approval-required: mint → consume → executes exactly once', async () => {
  const reg = new FakeRegistry();
  const { app } = buildApp({ registry: reg, approvals: new ToolApprovalStore() });
  const first = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'edit.apply', input: EDIT_INPUT } });
  const firstBody = first.json() as { status: string; approvalId: string; preview: unknown };
  assert.equal(firstBody.status, 'approval_required');
  assert.ok(firstBody.approvalId && firstBody.preview);
  assert.doesNotMatch(JSON.stringify((await app.inject({ method: 'GET', url: '/api/ai/audit' })).json()), /appr_/);
  assert.equal(reg.applied.length, 0, 'minting must not execute');
  const second = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'edit.apply', input: EDIT_INPUT, approvalId: firstBody.approvalId } });
  assert.equal((second.json() as { status: string }).status, 'executed');
  assert.equal(reg.applied.length, 1, 'executes exactly once');
  await app.close();
});

test('replay refusal: reusing a consumed approval → 409 INVALID_STATE, no re-exec', async () => {
  const reg = new FakeRegistry();
  const { app } = buildApp({ registry: reg, approvals: new ToolApprovalStore() });
  const approvalId = ((await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'edit.apply', input: EDIT_INPUT } })).json() as { approvalId: string }).approvalId;
  await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'edit.apply', input: EDIT_INPUT, approvalId } });
  const replay = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'edit.apply', input: EDIT_INPUT, approvalId } });
  assert.equal(replay.statusCode, 409);
  assert.equal((replay.json() as { code: string }).code, 'INVALID_STATE');
  assert.equal(reg.applied.length, 1, 'replay must not execute again');
  await app.close();
});

test('approval binding: a token cannot execute a different input', async () => {
  const reg = new FakeRegistry();
  const { app } = buildApp({ registry: reg, approvals: new ToolApprovalStore() });
  const approvalId = ((await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'edit.apply', input: EDIT_INPUT } })).json() as { approvalId: string }).approvalId;
  const tampered = { ...EDIT_INPUT, changes: [{ ...EDIT_INPUT.changes[0]!, replacement: 'EVIL' }] };
  const res = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'edit.apply', input: tampered, approvalId } });
  assert.equal(res.statusCode, 409);
  assert.equal(reg.applied.length, 0, 'mismatched input must not execute');
  await app.close();
});

test('engine failure: throwing handler → 502 TOOL_FAILED (sanitized)', async () => {
  const { app } = buildApp({ registry: new CapabilityRegistry() });
  const res = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'git.diff', input: { rootPath: '/nonexistent/xyzzy/path' } } });
  assert.equal(res.statusCode, 502);
  const body = res.json() as { code: string; error: string };
  assert.equal(body.code, 'TOOL_FAILED');
  assert.ok(!/stack|Error:|ENOENT|nonexistent/.test(body.error), 'sanitized error');
  await app.close();
});

test('approval store: idempotent mint, single-use consume, expiry, stable hash', () => {
  let t = 1000;
  let n = 0;
  const store = new ToolApprovalStore(() => t, () => `id-${n++}`, 100);
  const a = store.mint({ tool: 'edit.apply', inputHash: 'h1', requestId: 'r1' });
  const b = store.mint({ tool: 'edit.apply', inputHash: 'h1', requestId: 'r1' });
  assert.equal(a.id, b.id);
  assert.equal(store.consume(a.id, { tool: 'edit.apply', inputHash: 'h1' }).ok, true);
  assert.equal(store.consume(a.id, { tool: 'edit.apply', inputHash: 'h1' }).ok, false);
  const exp = store.mint({ tool: 'edit.apply', inputHash: 'h2', requestId: 'r2' });
  t += 200;
  assert.equal(store.consume(exp.id, { tool: 'edit.apply', inputHash: 'h2' }).ok, false);
  assert.equal(hashInput({ a: 1, b: 2 }), hashInput({ b: 2, a: 1 }));
});

test('approval store: owner rejection terminalizes an exact pending binding', () => {
  const store = new ToolApprovalStore(() => 1000, () => 'rejectable', 100);
  const approval = store.mint({ tool: 'command.run', inputHash: 'bound-hash', requestId: 'r-reject' });
  assert.equal(store.reject(approval.id, { tool: 'command.run', inputHash: 'wrong-hash' }), false);
  assert.equal(store.reject(approval.id, { tool: 'command.run', inputHash: 'bound-hash' }), true);
  assert.deepEqual(store.consume(approval.id, { tool: 'command.run', inputHash: 'bound-hash' }), { ok: false, reason: 'rejected' });
});

test('audit records executions + refusals and never contains inputs', async () => {
  const { app, audit } = buildApp();
  await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'git.status', input: { rootPath: process.cwd() } } });
  await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'nope', input: {} } });
  const events = audit.recent();
  assert.ok(events.some((e) => e.tool === 'git.status' && e.action === 'executed'));
  assert.ok(events.some((e) => e.tool === 'nope' && e.action === 'unknown_tool'));
  assert.ok(!JSON.stringify(events).includes('rootPath'), 'audit never contains inputs');
  await app.close();
});
