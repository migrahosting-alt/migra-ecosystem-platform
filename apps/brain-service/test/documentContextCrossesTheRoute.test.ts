/**
 * THE ROUTE MUST ACTUALLY PUT THE DOCUMENTS IN THE TURN.
 *
 * 🚨 WHY THIS EXISTS, AND WHY THE OTHER TESTS WERE NOT ENOUGH.
 *
 * `wholeDocumentReachesModel.test.ts` proves the PROVIDER renders a whole
 * document and a coverage caveat. `documentReadNotSampled.test.ts` proves the
 * SELECTION picks the right ones. Neither proves the ROUTE connects them, and
 * that is where a value gets dropped — the original defect was precisely a
 * closure in this route discarding `rag.diagnostics`.
 *
 * On staging the model was asked to quote the coverage sentence back and answered
 * "NONE". That is model-mediated evidence and therefore weak in BOTH directions:
 * a model can fail to comply, and an earlier reply that said "12 passages" could
 * equally have come from counting `Context from` blocks rather than from reading
 * the disclosure. A coincidence that looks like success is exactly what this
 * programme keeps being bitten by.
 *
 * So this captures the `ChatTurnRequest` the route hands the provider. No model
 * in the loop, nothing to interpret.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import { registerAiRoutes } from '../src/engine/chat/aiRoutes.js';
import { ModelRegistry, type ModelDescriptor } from '../src/engine/models/modelRegistry.js';
import { ConversationStore } from '../src/engine/memory/conversationStore.js';
import { IndexService, type FileSource, type Scope } from '../src/engine/rag/indexService.js';
import { FakeEmbedder } from '../src/engine/rag/embedder.js';
import type { ChatTurnRequest } from '@migrapilot/shared-types';

const STUB_ENV = { localProvider: 'stub', providerBaseUrl: '', openAiApiKey: undefined } as never;
const CAPS = { chat: true, vision: false, tools: true, embedding: false, reasoning: true, coding: true, insert: false };
const SCOPE: Scope = { owner: 'user:probe', workspace: 'ws:probe' };
const HEADERS = { 'x-owner-scope': SCOPE.owner, 'x-workspace-scope': SCOPE.workspace };

function stubModel(): ModelDescriptor {
  return { id: 'stub-1', provider: 'local', capabilities: CAPS, tier: 'balanced' };
}

/**
 * Captures the turn the route builds, and answers with something harmless.
 *
 * `complete` AND `stream` AND `isAvailable`, because the route selects a provider
 * before it uses one: a stub with only `stream` was reported as COMPLETION_FAILED
 * and pushed nothing, so the first version of these tests failed with "the route
 * never reached the provider" while the route was in fact fine.
 */
function capturingProvider(seen: ChatTurnRequest[]) {
  return () =>
    ({
      profile: 'default' as const,
      async isAvailable() { return true; },
      async complete(request: ChatTurnRequest) {
        seen.push(request);
        return {
          content: 'ok',
          modelId: 'stub-1', providerId: 'local',
          telemetry: { inputTokens: 1, outputTokens: 1, latencyMs: 1 },
        };
      },
      async *stream(request: ChatTurnRequest) {
        seen.push(request);
        yield { delta: 'ok' };
        yield { usage: { inputTokens: 1, outputTokens: 1 } };
      },
    }) as never;
}

/**
 * An index over the given files, synced and approved.
 *
 * Approved on purpose: production retrieval is bound to the approved generation,
 * so an unapproved index would make these tests pass or fail for a reason that
 * has nothing to do with documents.
 */
async function indexOver(
  files: Array<{ relPath: string; content: string; complete?: boolean; incompleteReason?: string }>,
): Promise<IndexService> {
  let clock = 1_000_000;
  const service = new IndexService(
    new FakeEmbedder(64),
    (): FileSource => ({ files: async () => files }),
    () => (clock += 1000),
  );
  const rec = await service.createIndex(SCOPE, { sourceType: 'docs', root: '/r' });
  await service.sync(rec.id, SCOPE);
  await service.setState(rec.id, SCOPE, 'approved');
  return service;
}

async function askAbout(
  service: IndexService,
  groundingFiles: string[],
  prompt = 'what does it say?',
): Promise<ChatTurnRequest | undefined> {
  const seen: ChatTurnRequest[] = [];
  const app = Fastify({ logger: false });
  registerAiRoutes(
    app, STUB_ENV,
    new ModelRegistry({ sources: [], staticModels: [stubModel()] }),
    new ConversationStore(),
    capturingProvider(seen),
    undefined,
    service,
  );
  await app.inject({
    method: 'POST', url: '/api/ai/chat', headers: HEADERS,
    payload: { prompt, groundingFiles, groundingMode: 'approved' },
  });
  await app.close();
  return seen[0];
}

/** Text large enough to exceed the 8,000-token document budget. */
const oversized = (): string => 'contract renewal variance forecast margin. '.repeat(1_200);

test('🚨 a small document reaches the turn IN FULL', async () => {
  const service = await indexOver([
    { relPath: 'deck.pptx', content: 'Slide 1 --- Opening\nSlide 31 --- CLOSING MARKER OMEGA' },
  ]);

  const turn = await askAbout(service, ['deck.pptx']);
  assert.ok(turn, 'the route never reached the provider');
  const whole = turn.context.wholeDocuments ?? [];
  assert.equal(whole.length, 1, 'the document was not supplied whole');
  assert.match(whole[0]!.text, /CLOSING MARKER OMEGA/,
    'only part of the document crossed the route — the far end is missing');
});

test('🚨 a sampled document reaches the turn WITH its coverage', async () => {
  /*
   * THE ASSERTION THE STAGING PROBE COULD NOT MAKE. `passagesTotal` must be the
   * document's own chunk count, and it must exceed what was provided, or the
   * caveat never renders and the model goes on reporting absence.
   */
  const service = await indexOver([{ relPath: 'long-contract.txt', content: oversized() }]);

  const turn = await askAbout(service, ['long-contract.txt']);
  assert.ok(turn, 'the route never reached the provider');
  assert.equal((turn.context.wholeDocuments ?? []).length, 0,
    'an oversized document was sent whole, past the budget');

  const cov = turn.context.retrievalCoverage ?? [];
  assert.equal(cov.length, 1, 'no coverage crossed the route for a sampled document');
  assert.equal(cov[0]!.path, 'long-contract.txt');
  assert.ok(cov[0]!.passagesTotal > cov[0]!.passagesProvided,
    `coverage does not show a shortfall: ${JSON.stringify(cov[0])}`);
  assert.ok(cov[0]!.passagesProvided > 0, 'a sampled document supplied no passages at all');
});

test('a whole document carries no coverage caveat', async () => {
  // Telling the model it holds a sample of something it holds entirely teaches
  // needless hedging, which is its own dishonesty.
  const service = await indexOver([{ relPath: 'notes.md', content: 'A short note about revenue.' }]);

  const turn = await askAbout(service, ['notes.md']);
  assert.ok(turn);
  assert.equal((turn.context.wholeDocuments ?? []).length, 1);
  assert.equal((turn.context.retrievalCoverage ?? []).length, 0,
    'a document read whole was labelled a sample');
});

test('🚨 incompleteness crosses the route, not just the extractor', async () => {
  const service = await indexOver([
    {
      relPath: 'deck.pptx',
      content: 'Slide 1 --- Opening',
      complete: false,
      incompleteReason: 'This deck contains charts, which cannot be read as text.',
    },
  ]);

  const turn = await askAbout(service, ['deck.pptx']);
  assert.ok(turn);
  const doc = (turn.context.wholeDocuments ?? [])[0];
  assert.ok(doc, 'the document did not reach the turn');
  assert.equal(doc.complete, false, 'the unread-charts fact was lost between index and turn');
  assert.match(String(doc.incompleteReason), /charts/i);
});

test('a turn holding only a whole document is still answered, not refused', async () => {
  /*
   * The regression this feature introduced, asserted at the ROUTE. Reading the
   * document whole leaves nothing to retrieve, and zero passages used to be read
   * as "no evidence" — so attaching a SMALL document refused the answer while a
   * large one worked.
   */
  const service = await indexOver([{ relPath: 'notes.md', content: 'A short note about revenue.' }]);
  const turn = await askAbout(service, ['notes.md']);
  assert.ok(turn, 'the turn was refused before reaching the provider');
});
