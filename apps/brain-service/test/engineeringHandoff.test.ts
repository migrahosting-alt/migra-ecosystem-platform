import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { ChatTurnRequest } from '@migrapilot/shared-types';
import { OpenAiCompatProvider } from '../src/providers/openAiCompatProvider.js';
import { ENGINEERING_HANDOFF_GUIDANCE } from '../src/engine/chat/handoffGuidance.js';
import { runEngineerTask, type EngineerEvent } from '../src/engine/engineer/engineerRuntime.js';
import { ENGINEERING_HANDOFF, HANDOFF_FOLLOW_UP } from './fixtures/engineeringHandoff.js';

interface WireMessage {
  role: string;
  content: string;
}

async function providerMessages(
  t: TestContext,
  systemPromptId: string,
  userPrompt = ENGINEERING_HANDOFF,
): Promise<WireMessage[]> {
  let sent: string | undefined;
  const fetchMock = t.mock.method(globalThis, 'fetch', async (
    _input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    assert.equal(typeof init?.body, 'string');
    sent = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'fixture response' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  try {
    const provider = new OpenAiCompatProvider({
      profile: 'default',
      baseUrl: 'http://provider.invalid/v1',
      model: 'fixture-model',
    });
    const request: ChatTurnRequest = {
      feature: 'chat',
      modelProfile: 'default',
      systemPromptId,
      userPrompt,
      context: {},
      outputMode: 'markdown',
    };
    await provider.complete(request);
  } finally {
    fetchMock.mock.restore();
  }
  assert.ok(sent, 'no provider request was captured');
  const body = JSON.parse(sent) as { messages: WireMessage[] };
  return body.messages;
}

for (const persona of ['ai-chat-v1', 'engineer-v1']) {
  test(`${persona} sends the handoff contract and unchanged owner report on the wire`, async (t) => {
    const messages = await providerMessages(t, persona);
    const system = messages.find((message) => message.role === 'system')?.content;
    assert.ok(system, 'no system message reached the provider');
    assert.ok(system.includes(ENGINEERING_HANDOFF_GUIDANCE));
    assert.equal(system.split(ENGINEERING_HANDOFF_GUIDANCE).length - 1, 1);
    assert.equal(messages.at(-1)?.content, ENGINEERING_HANDOFF);
    assert.match(system, /two to four concise sentences/);
    assert.match(system, /user-reported, not independently verified/);
    assert.match(system, /exactly one focused next-step question/);
    assert.match(system, /whether that specific file is free/);
    assert.match(system, /context, not fresh authorization/);
  });
}

test('explicit summaries and new action requests retain priority over handoff follow-up', async (t) => {
  for (const instruction of [
    'Summarize this report in three bullets.',
    'Translate this report into French.',
    'Rewrite this report for a release note.',
    'Please implement the camera publish path; the file is now free.',
  ]) {
    const prompt = `${instruction}\n\n${ENGINEERING_HANDOFF}`;
    const messages = await providerMessages(t, 'ai-chat-v1', prompt);
    assert.equal(messages.at(-1)?.content, prompt);
    assert.match(messages[0]!.content, /summary, translation or rewrite, do that instead/);
    assert.match(messages[0]!.content, /follow that request within existing authority and approval gates/);
    assert.match(messages[0]!.content, /do not replace it with a summary/);
  }
});

test('parser-only and embedded safe-read personas do not acquire handoff instructions', async (t) => {
  for (const persona of ['commit-message-v1', 'generate-tests-v1', 'assistant.safe-read']) {
    const messages = await providerMessages(t, persona);
    assert.ok(!messages.some((message) => message.role === 'system' && message.content.includes(ENGINEERING_HANDOFF_GUIDANCE)));
  }
});

test('the Engineer controller carries the shared guidance and accepts a focused no-tool follow-up', async () => {
  const prompts: string[] = [];
  const events: EngineerEvent[] = [];
  const tools: string[] = [];
  for await (const event of runEngineerTask({
    complete: async (prompt) => {
      prompts.push(prompt);
      return JSON.stringify({ final: HANDOFF_FOLLOW_UP });
    },
    executeTool: async (tool) => {
      tools.push(tool);
      throw new Error('a pasted handoff must not execute a tool');
    },
    tools: [],
  }, { rootPath: '/fixture', task: ENGINEERING_HANDOFF })) {
    events.push(event);
  }
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0]?.includes(ENGINEERING_HANDOFF_GUIDANCE));
  assert.ok(prompts[0]?.includes(ENGINEERING_HANDOFF));
  assert.deepEqual(tools, []);
  const finals = events.filter((event) => event.type === 'final');
  assert.equal(finals.length, 1);
  assert.equal(finals[0]?.type === 'final' && finals[0].markdown, HANDOFF_FOLLOW_UP);
});
