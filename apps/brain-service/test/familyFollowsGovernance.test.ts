// THE PROOF THAT THIS IS AN ABSTRACTION, NOT SIX BRANDED ALIASES.
//
// Change ONLY the governed decision — no client code, no catalog edit, no
// rebuild — and every surface must resolve the family to the new backend.
//
// If this test can ever be made to pass by editing a client, the families are
// aliases. It is written against the SHARED resolver that both MigraPilot and
// the VS Code extension call through, and it asserts the two surfaces agree with
// each other as well as with governance.

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveFamily, resolveFamiliesForSurface } from '../src/engine/models/modelFamilyResolver.js';
import type { ModelDescriptor } from '../src/engine/models/modelRegistry.js';
import { MIGRA_MODEL_FAMILIES, MIGRA_FAMILY_IDS } from '@migrapilot/shared-types/model-families';

const chatModel = (id: string): ModelDescriptor => ({
  id,
  provider: 'ollama',
  tier: 'balanced',
  contextLength: 131072,
  capabilities: {
    chat: true, vision: false, tools: true, embedding: false,
    reasoning: true, coding: true, insert: false,
  },
});

/** Both candidate backends are installed the whole time. Only the DECISION moves. */
const BACKEND_A = chatModel('backend-a:8b');
const BACKEND_B = chatModel('backend-b:8b');
const INSTALLED = [BACKEND_A, BACKEND_B];

/** A governance table, as the durable decision store would answer it. */
const governanceNaming = (modelId: string) => () => ({ qualified: true, modelId });

test('DAY 1 → DAY 2: changing only governance moves the family to a new backend', () => {
  const capability = MIGRA_MODEL_FAMILIES['migra-core'].requirements.governedCapability;
  assert.ok(capability, 'Core must resolve through a governed capability');

  // Day 1 — governance approves backend A.
  const day1 = resolveFamily('migra-core', {
    models: INSTALLED,
    governedDecision: governanceNaming('backend-a:8b'),
  });
  assert.equal(day1.available, true);
  assert.equal(day1.selectedBackend, 'backend-a:8b');
  assert.equal(day1.governed, true);

  // Day 2 — the ONLY change is the decision. No code, no catalog, no rebuild.
  const day2 = resolveFamily('migra-core', {
    models: INSTALLED,
    governedDecision: governanceNaming('backend-b:8b'),
  });
  assert.equal(day2.selectedBackend, 'backend-b:8b', 'the family did not follow governance');
  assert.equal(day2.basis, capability, 'the basis must name the capability, not a model');
});

test('BOTH surfaces follow the same change, and agree with each other', () => {
  for (const [label, modelId] of [['day1', 'backend-a:8b'], ['day2', 'backend-b:8b']] as const) {
    const consumer = resolveFamiliesForSurface('migrapilot-consumer', {
      models: INSTALLED,
      governedDecision: governanceNaming(modelId),
    });
    const extension = resolveFamiliesForSurface('vscode-extension', {
      models: INSTALLED,
      governedDecision: governanceNaming(modelId),
    });
    const pick = (rs: typeof consumer, id: string) => rs.find((r) => r.family === id)?.selectedBackend;

    assert.equal(pick(consumer, 'migra-core'), modelId, `consumer did not follow governance on ${label}`);
    assert.equal(pick(extension, 'migra-core'), modelId, `extension did not follow governance on ${label}`);
    // And the two surfaces must not diverge from each other.
    for (const id of MIGRA_FAMILY_IDS) {
      const inBoth =
        MIGRA_MODEL_FAMILIES[id].surfaces.includes('migrapilot-consumer') &&
        MIGRA_MODEL_FAMILIES[id].surfaces.includes('vscode-extension');
      if (!inBoth) continue;
      assert.equal(pick(consumer, id), pick(extension, id), `${id} resolved differently per surface on ${label}`);
    }
  }
});

test('revoking the decision makes the family unavailable — no fallback is inserted', () => {
  // Both backends are still installed and still capable. Only approval is gone.
  const revoked = resolveFamily('migra-core', {
    models: INSTALLED,
    governedDecision: () => ({ qualified: false, modelId: null }),
  });
  assert.equal(revoked.available, false, 'an unapproved family must not be served by a capable model');
  assert.equal(revoked.selectedBackend, undefined, 'no fallback may be inserted to keep the selector working');
});

test('NO family hard-codes a backend, provider, runtime or status in the catalog', () => {
  // The catalog may declare identity and requirements. Anything operational —
  // a model id, a provider, a GPU class, a readiness word — belongs to runtime.
  const forbidden = [
    /qwen/i, /llama/i, /deepseek/i, /minicpm/i, /llava/i, /gpt-oss/i,
    /ollama/i, /runpod/i, /gpu/i, /sha256/i,
    /PROVEN_LIVE/, /\bPARTIAL\b/, /\bBLOCKED\b/, /\bINTENT\b/,
  ];
  const serialised = JSON.stringify(MIGRA_MODEL_FAMILIES);
  const leaked = forbidden.filter((re) => re.test(serialised)).map((re) => re.source);
  assert.deepEqual(leaked, [], 'the catalog encodes operational truth that must be resolved at runtime');
});

test('every family declares a governance basis — capability or measured grant', () => {
  // A family with neither would resolve on capability matching alone, which is
  // the ungoverned path this layer exists to make visible rather than default.
  const ungoverned = MIGRA_FAMILY_IDS.filter((id) => {
    const req = MIGRA_MODEL_FAMILIES[id].requirements;
    return !req.governedCapability && !(req.taskClasses && req.taskClasses.length > 0);
  });
  assert.deepEqual(ungoverned, [], 'these families rest on no governance basis at all');
});
