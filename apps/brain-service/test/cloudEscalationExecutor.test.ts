// Intelligent Provider Router — Slice 3, commit 2: one-shot cloud executor.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CloudEscalationExecutor, type CloudProviderFactory } from '../src/engine/providers/cloudEscalationExecutor.js';
import { auditStore } from '../src/engine/auditLog.js';
import type { Provider } from '../src/engine/providers/types.js';
import type { ChatTurnRequest } from '@migrapilot/shared-types';

const REQ: ChatTurnRequest = { feature: 'chat', modelProfile: 'default', systemPromptId: 'x', userPrompt: 'fix the bug', context: {}, outputMode: 'markdown' };
function cloud(): Provider {
  return { id: 'anthropic', displayName: 'Claude', kind: 'cloud', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', credentialEnv: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-5', capabilities: { chat: true, vision: true, tools: true, embedding: false, reasoning: true, coding: true }, priority: 60, cost: { inputPer1M: 3, outputPer1M: 15 }, dataLocality: 'external', enabled: true };
}
function factory(onCall: () => void, mode: 'ok' | 'throw'): CloudProviderFactory {
  return () => ({
    name: 'cloud',
    async complete() {
      onCall();
      if (mode === 'throw') throw new Error('upstream 500 with key sk-secret-should-not-leak');
      return { content: 'cloud produced the fix', model: 'claude-sonnet-5', telemetry: { inputTokens: 10, outputTokens: 20, latencyMs: 5 } } as never;
    },
    async *stream() { /* unused */ },
    async isAvailable() { return true; },
  } as never);
}

test('one approved attempt succeeds, is attributed, and is audited (attempted → completed)', async () => {
  let calls = 0;
  const exec = new CloudEscalationExecutor(factory(() => { calls++; }, 'ok'), { ANTHROPIC_API_KEY: 'present' });
  const r = await exec.attempt({ correlationId: 'esc-corr-1', provider: cloud(), modelId: 'claude-sonnet-5', reason: 'LOCAL_TIMEOUT', request: REQ });
  assert.equal(r.ok, true);
  assert.equal(r.viaEscalation, true);
  assert.equal(r.provider, 'anthropic');
  assert.equal(r.model, 'claude-sonnet-5');
  assert.equal(r.reason, 'LOCAL_TIMEOUT');
  assert.equal(r.content, 'cloud produced the fix');
  assert.equal(calls, 1, 'exactly ONE attempt');
  const types = auditStore.byCorrelation('esc-corr-1').map((e) => e.type);
  assert.ok(types.includes('escalation.attempted') && types.includes('escalation.completed'));
});

test('exactly one attempt — a failure does NOT retry, and the error is sanitized', async () => {
  let calls = 0;
  const exec = new CloudEscalationExecutor(factory(() => { calls++; }, 'throw'), { ANTHROPIC_API_KEY: 'present' });
  const r = await exec.attempt({ correlationId: 'esc-corr-2', provider: cloud(), modelId: 'claude-sonnet-5', reason: 'LOCAL_CONTEXT_LIMIT', request: REQ });
  assert.equal(r.ok, false);
  assert.equal(calls, 1, 'no retry after failure');
  assert.ok(!String(r.error).includes('sk-secret-should-not-leak'), 'error is sanitized');
  const types = auditStore.byCorrelation('esc-corr-2').map((e) => e.type);
  assert.ok(types.includes('escalation.attempted') && types.includes('escalation.failed'));
});

test('fail-closed: a missing credential never constructs a client or calls out', async () => {
  let calls = 0;
  const exec = new CloudEscalationExecutor(factory(() => { calls++; }, 'ok'), {}); // no ANTHROPIC_API_KEY
  const r = await exec.attempt({ correlationId: 'esc-corr-3', provider: cloud(), modelId: 'claude-sonnet-5', reason: 'LOCAL_TIMEOUT', request: REQ });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /credential unavailable/);
  assert.equal(calls, 0, 'no cloud client constructed or called');
});
