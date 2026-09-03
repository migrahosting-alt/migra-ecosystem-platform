// The wire field must reach the model — proven through the REAL route.
//
// `designSpec` crossing the transport and `specification` shaping the prompt were
// each covered separately, which still leaves the seam between them untested: a
// route that parsed the field and forgot to pass it on would satisfy both halves
// and drop the requirement on the floor. This drives POST /api/ai/engineer and
// reads the prompt the provider was actually handed.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { registerEngineerRoutes } from '../src/engine/engineerRoutes.js';
import { registerToolExecutionRoutes } from '../src/engine/toolRoutes.js';
import { ModelRegistry, type ModelDescriptor } from '../src/engine/modelRegistry.js';
import type { ProviderAdapter } from '../src/providers/providerRegistry.js';

const STUB_ENV = { localProvider: 'stub', providerBaseUrl: '', openAiApiKey: undefined } as never;
const SPEC = '[design specification] A hero with a headline, a two-column feature row, and a footer.';

function model(id: string): ModelDescriptor {
  return { id, provider: 'local', capabilities: { chat: true, vision: false, tools: true, embedding: false, reasoning: true, coding: true, insert: false }, tier: 'balanced' };
}

/** Captures every prompt the loop sends, then ends the run. */
function capturingApp(seen: string[]) {
  // BOTH paths are recorded. The loop streams its answer, so hooking only
  // `complete` captured nothing and the assertions passed over an empty list —
  // the failure mode where a test proves the absence of its own evidence.
  // `userPrompt` FIRST — that is the field this engine actually fills. Reading only
  // `prompt`/`messages` returned empty strings, and the assertions then failed against
  // evidence the test had never collected, which looked exactly like a broken route.
  const promptOf = (req: { userPrompt?: string; prompt?: string; messages?: Array<{ content?: string }> }): string =>
    req?.userPrompt ?? req?.prompt ?? (req?.messages ?? []).map((m) => m?.content ?? '').join('\n');
  const adapter: ProviderAdapter = {
    name: 'stub',
    async complete(req: { userPrompt?: string; prompt?: string; messages?: Array<{ content?: string }> }) {
      seen.push(promptOf(req));
      return { content: '{"final":"done"}', model: 'stub', usage: { promptTokens: 1, completionTokens: 1 } } as never;
    },
    async *stream(req: { userPrompt?: string; prompt?: string; messages?: Array<{ content?: string }> }) {
      seen.push(promptOf(req));
      yield { delta: '{"final":"done"}' } as never;
    },
    async isAvailable() { return true; },
  } as never;
  const app = Fastify({ logger: false });
  const toolDeps = registerToolExecutionRoutes(app);
  registerEngineerRoutes(app, STUB_ENV, new ModelRegistry({ sources: [], staticModels: [model('local-coder')] }), toolDeps, () => adapter);
  return app;
}

test('designSpec sent to the route reaches the model as the specification to build from', async () => {
  const seen: string[] = [];
  const app = capturingApp(seen);
  await app.inject({
    method: 'POST',
    url: '/api/ai/engineer',
    payload: {
      rootPath: mkdtempSync(tmpdir() + '/eng-spec-'),
      task: 'use the mockup draft and build this page exactly as it is.',
      designSpec: SPEC,
    },
  });
  await app.close();
  const all = seen.join('\n---\n');
  assert.ok(seen.length > 0, 'the provider must have been called');
  assert.match(all, /THE SPECIFICATION YOU WERE ASKED TO BUILD FROM/, 'the spec block must be in the prompt');
  assert.ok(all.includes(SPEC), 'the specification text itself must reach the model');
});

test('a request with no designSpec carries no specification block', async () => {
  const seen: string[] = [];
  const app = capturingApp(seen);
  await app.inject({
    method: 'POST',
    url: '/api/ai/engineer',
    payload: { rootPath: mkdtempSync(tmpdir() + '/eng-nospec-'), task: 'build me a website' },
  });
  await app.close();
  assert.ok(seen.some((p) => p.length > 0), 'the provider must have been called with a real prompt');
  assert.match(seen.join('\n'), /THE USER'S CURRENT MESSAGE/, 'sanity: this IS the engineer prompt');
  assert.doesNotMatch(seen.join('\n'), /THE SPECIFICATION YOU WERE ASKED TO BUILD FROM/);
});
