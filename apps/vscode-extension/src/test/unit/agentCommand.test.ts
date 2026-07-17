import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAgentCommand, runAgentCommand, renderRunView } from '../../chat/agentCommand.js';
import type { AgentRunView, MigraAiClient } from '../../services/migraAiClient.js';
import { PilotError } from '@migrapilot/pilot-client';

function view(over: Partial<AgentRunView> = {}): AgentRunView {
  return {
    runId: 'run_1', requestId: 'req_1', agentId: 'workspace.diagnostics.pilot', agentVersion: '1',
    runtime: 'pilot', state: 'COMPLETED', steps: [], result: { count: 0, items: [] },
    createdAt: 1, updatedAt: 2, history: [], ...over,
  };
}

test('parse: /agent forms', () => {
  assert.equal(parseAgentCommand('hello world'), null, 'non-command falls through to chat');
  assert.deepEqual(parseAgentCommand('/agent'), { kind: 'usage' });
  assert.deepEqual(parseAgentCommand('/agent workspace.diagnostics.pilot'), { kind: 'run', agentId: 'workspace.diagnostics.pilot' });
  assert.deepEqual(parseAgentCommand('/agent workspace.diagnostics.pilot {"rootPath":"/r","path":"f.ts"}'), { kind: 'run', agentId: 'workspace.diagnostics.pilot', input: { rootPath: '/r', path: 'f.ts' } });
  assert.deepEqual(parseAgentCommand('/agent approve run_9'), { kind: 'approve', runId: 'run_9' });
  assert.deepEqual(parseAgentCommand('/agent reject run_9'), { kind: 'reject', runId: 'run_9' });
  assert.deepEqual(parseAgentCommand('/agent status run_9'), { kind: 'status', runId: 'run_9' });
  assert.equal(parseAgentCommand('/agent x {bad json')?.kind, 'usage');
});

test('render FAILED → machine execution error, never an apology', () => {
  const out = renderRunView(view({ state: 'FAILED', result: undefined, error: { code: 'RUNTIME_UNAVAILABLE', message: 'The remote agent runtime is not enabled.' } }));
  assert.match(out, /Runtime execution failed/);
  assert.match(out, /Runtime: pilot/);
  assert.match(out, /Failure: RUNTIME_UNAVAILABLE/);
  assert.match(out, /Tool not executed/);
  assert.match(out, /run_1/);
  assert.doesNotMatch(out, /unfortunately|sorry|i can't|i cannot/i, 'no LLM-style apology');
});

test('render COMPLETED → structured JSON only', () => {
  const out = renderRunView(view());
  assert.match(out, /```json/);
  assert.match(out, /"state": "COMPLETED"/);
  assert.match(out, /"count": 0/);
  assert.doesNotMatch(out, /unfortunately|sorry/i);
});

test('render WAITING_FOR_APPROVAL → parked block + approve/reject by runId', () => {
  const out = renderRunView(view({ state: 'WAITING_FOR_APPROVAL', result: undefined, pendingAction: { actionId: 'a1', tool: 'edit.apply', summary: 'Apply a fix' } }));
  assert.match(out, /approval required/i);
  assert.match(out, /edit\.apply/);
  assert.match(out, /\/agent approve run_1/);
  assert.doesNotMatch(out, /appr_|approvalId/i, 'no approval material rendered');
});

test('run dispatch: create/approve/status route to the client; output is model-free', async () => {
  const calls: string[] = [];
  const md: string[] = [];
  const fake = {
    createAgentRun: async (req: { agentId: string }) => { calls.push(`create:${req.agentId}`); return view(); },
    getAgentRun: async (id: string) => { calls.push(`get:${id}`); return view(); },
    resumeAgentRun: async (id: string, d: string) => { calls.push(`resume:${id}:${d}`); return view({ state: 'COMPLETED' }); },
  } as unknown as MigraAiClient;
  const sink = { markdown: (t: string) => md.push(t) };

  await runAgentCommand(fake, { kind: 'run', agentId: 'workspace.diagnostics.pilot' }, sink, { rootPath: '/ws', path: 'f.ts' });
  await runAgentCommand(fake, { kind: 'approve', runId: 'run_1' }, sink);
  await runAgentCommand(fake, { kind: 'status', runId: 'run_1' }, sink);
  assert.deepEqual(calls, ['create:workspace.diagnostics.pilot', 'resume:run_1:approve', 'get:run_1']);
  assert.ok(md.every((t) => !/unfortunately|sorry/i.test(t)));
});

test('INVALID_INPUT surfaces the schema issues in the machine block (truthful, not SERVER_ERROR)', async () => {
  const md: string[] = [];
  const fake = {
    createAgentRun: async () => {
      throw new PilotError('INVALID_INPUT', 'Agent input failed schema validation. (rootPath: Required; path: Required)', { requestId: 'req_88' });
    },
  } as unknown as MigraAiClient;
  await runAgentCommand(fake, { kind: 'run', agentId: 'workspace.diagnostics.pilot' }, { markdown: (t) => md.push(t) });
  const out = md.join('\n');
  assert.match(out, /Runtime dispatch failed before execution/);
  assert.match(out, /Failure: INVALID_INPUT — Agent input failed schema validation\. \(rootPath: Required; path: Required\)/);
  assert.match(out, /Tool not executed/);
  assert.match(out, /req_88/);
  assert.doesNotMatch(out, /SERVER_ERROR/);
  assert.doesNotMatch(out, /unfortunately|sorry/i);
});

test('transport failure → machine dispatch error with the PilotError code (no chat fallback)', async () => {
  const md: string[] = [];
  const fake = {
    createAgentRun: async () => { throw new PilotError('NOT_READY', 'engine down', { requestId: 'req_77' }); },
  } as unknown as MigraAiClient;
  await runAgentCommand(fake, { kind: 'run', agentId: 'x' }, { markdown: (t) => md.push(t) });
  const out = md.join('\n');
  assert.match(out, /Runtime dispatch failed before execution/);
  assert.match(out, /Failure: NOT_READY/);
  assert.match(out, /Tool not executed/);
  assert.match(out, /req_77/);
  assert.doesNotMatch(out, /unfortunately|sorry/i);
});
