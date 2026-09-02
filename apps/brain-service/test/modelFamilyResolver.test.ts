// Migra Models v1 — family resolution against governance.
//
// The rule these defend: a family is available ONLY when something qualified
// satisfies it. Silently serving a weaker model while keeping the label is the
// failure this layer exists to prevent, so "unavailable" must be reachable and
// must never be papered over.

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveFamily, resolveFamiliesForSurface, meetsRequirements } from '../src/engine/modelFamilyResolver.js';
import type { ModelDescriptor } from '../src/engine/modelRegistry.js';
import {
  MIGRA_MODEL_FAMILIES,
  MIGRA_FAMILY_IDS,
} from '@migrapilot/shared-types/model-families';

const model = (
  id: string,
  tier: 'fast' | 'balanced' | 'deep',
  caps: Partial<ModelDescriptor['capabilities']>,
  contextLength = 32768,
): ModelDescriptor => ({
  id,
  provider: 'ollama',
  tier,
  contextLength,
  capabilities: {
    chat: false, vision: false, tools: false, embedding: false,
    reasoning: false, coding: false, insert: false, ...caps,
  },
});

const VISION = model('qwen2.5vl:7b', 'balanced', { chat: true, vision: true }, 128000);
const CODER = model('qwen2.5-coder:14b', 'balanced', { chat: true, coding: true, tools: true });
const CHAT = model('qwen3:8b', 'balanced', { chat: true, tools: true, reasoning: true }, 40960);

test('every catalog family resolves to a decision — none is unhandled', () => {
  const out = resolveFamiliesForSurface('vscode-extension', { models: [VISION, CODER, CHAT] });
  const handled = out.map((r) => r.family).sort();
  const expected = MIGRA_FAMILY_IDS.filter((id) =>
    MIGRA_MODEL_FAMILIES[id].surfaces.includes('vscode-extension'),
  ).sort();
  assert.deepEqual(handled, expected);
});

test('a governed decision WINS — a human approval outranks a capability flag', () => {
  const r = resolveFamily('migra-vision', {
    models: [VISION, CODER],
    governedDecision: () => ({ qualified: true, modelId: 'qwen2.5vl:7b' }),
  });
  assert.equal(r.available, true);
  assert.equal(r.governed, true);
  assert.equal(r.selectedBackend, 'qwen2.5vl:7b');
  assert.equal(r.basis, 'vision.general');
});

test('NO approved model for a governed capability means UNAVAILABLE, never a substitute', () => {
  const r = resolveFamily('migra-vision', {
    // A vision-capable model IS installed — it just is not approved.
    models: [VISION, CODER],
    governedDecision: () => ({ qualified: false, modelId: null }),
  });
  assert.equal(r.available, false);
  assert.equal(r.selectedBackend, undefined, 'an unapproved model must not be offered');
  assert.match(r.unavailableReason ?? '', /no approved model for vision\.general/);
});

test('an approved model that is not installed is unavailable, and says which', () => {
  const r = resolveFamily('migra-vision', {
    models: [CODER],
    governedDecision: () => ({ qualified: true, modelId: 'qwen2.5vl:7b' }),
  });
  assert.equal(r.available, false);
  assert.equal(r.governed, true);
  assert.match(r.unavailableReason ?? '', /not installed/);
});

test('a task-class grant is a governed basis, and names the class', () => {
  const r = resolveFamily('migra-forge', {
    models: [CODER, CHAT],
    approvedForTaskClass: (tc) => (tc === 'typed-implementation' ? ['qwen2.5-coder:14b'] : []),
  });
  assert.equal(r.available, true);
  assert.equal(r.governed, true);
  assert.equal(r.selectedBackend, 'qwen2.5-coder:14b');
  assert.equal(r.basis, 'grant:typed-implementation');
});

test('with no grant, a capability match is offered but labelled UNGOVERNED', () => {
  const r = resolveFamily('migra-forge', { models: [CODER], approvedForTaskClass: () => [] });
  assert.equal(r.available, true);
  assert.equal(r.governed, false, 'an ungoverned match must not claim governance');
  assert.match(r.basis ?? '', /ungoverned/);
});

test('a family whose requirements nothing meets is unavailable', () => {
  // Only a coder is installed; Vision needs vision.
  const r = resolveFamily('migra-vision', { models: [CODER], governedDecision: () => undefined });
  assert.equal(r.available, false);
});

test('context floor is enforced — an advertised window below the floor does not qualify', () => {
  // Tested on the predicate: Atlas is audit-gated, so resolution never reaches
  // the floor check through it, and the floor must still be provably enforced.
  const shortCtx = model('small-ctx', 'balanced', { chat: true }, 8192);
  const longCtx = model('long-ctx', 'balanced', { chat: true }, 200_000);
  const atlas = MIGRA_MODEL_FAMILIES['migra-atlas'];
  assert.equal(meetsRequirements(shortCtx, atlas), false);
  assert.equal(meetsRequirements(longCtx, atlas), true);
});

test('tier floor is enforced — a fast model cannot satisfy a deep family', () => {
  const fastReasoner = model('tiny-r1', 'fast', { chat: true, reasoning: true });
  const deepReasoner = model('big-r1', 'deep', { chat: true, reasoning: true });
  const logic = MIGRA_MODEL_FAMILIES['migra-logic'];
  assert.equal(meetsRequirements(fastReasoner, logic), false);
  assert.equal(meetsRequirements(deepReasoner, logic), true);
  // And a fast coder cannot satisfy Forge, which floors at balanced.
  const fastCoder = model('tiny-coder', 'fast', { chat: true, coding: true, tools: true });
  assert.equal(resolveFamily('migra-forge', { models: [fastCoder] }).available, false);
});

test('no family resolves to a model missing a required capability', () => {
  const all = [VISION, CODER, CHAT];
  for (const id of MIGRA_FAMILY_IDS) {
    const r = resolveFamily(id, { models: all });
    if (!r.available || !r.selectedBackend) continue;
    const chosen = all.find((m) => m.id === r.selectedBackend)!;
    for (const cap of MIGRA_MODEL_FAMILIES[id].requirements.capabilities) {
      assert.equal(chosen.capabilities[cap], true, `${id} chose ${chosen.id} lacking ${cap}`);
    }
  }
});

// ── the two defects the FIRST live read exposed ────────────────────────────

test('a model that cannot run under the current policy is never offered', () => {
  const cloud = model('gpt-oss:120b-cloud', 'deep', { chat: true, tools: true, reasoning: true }, 131072);
  // Listed by the provider, but unusable while the policy is local-only.
  const r = resolveFamily('migra-core', { models: [cloud], executable: (m) => !/-cloud$/.test(m.id) });
  assert.equal(r.available, false, 'offering an unrunnable model is fake readiness');
});

test('a governed decision naming an unrunnable model is also refused', () => {
  const cloudVision = model('vision-cloud', 'balanced', { chat: true, vision: true }, 128000);
  const r = resolveFamily('migra-vision', {
    models: [cloudVision],
    governedDecision: () => ({ qualified: true, modelId: 'vision-cloud' }),
    executable: (m) => !/-cloud$/.test(m.id),
  });
  assert.equal(r.available, false, 'approval does not make a model runnable');
});

test('a "fastest" family takes the smallest model over the floor, not the largest', () => {
  // Core prefers fastest; both clear its balanced floor. Reached through its
  // governed capability, which is now the only way Core resolves at all.
  const mid = model('mid', 'balanced', { chat: true, tools: true });
  const huge = model('huge', 'deep', { chat: true, tools: true });
  const r = resolveFamily('migra-core', {
    models: [huge, mid],
    // Approved for the capability without naming a model would be meaningless;
    // the decision names one, so preference is exercised via the grant path below.
    governedDecision: () => ({ qualified: true, modelId: 'mid' }),
  });
  assert.equal(r.selectedBackend, 'mid', 'the approved model is the one that runs');
});

test('preference picks the smallest granted model for a "fastest" family', () => {
  const small = model('small-coder', 'balanced', { chat: true, coding: true, tools: true });
  const big = model('big-coder', 'deep', { chat: true, coding: true, tools: true });
  // Forge prefers STRONGEST, so it must take the deep one.
  const r = resolveFamily('migra-forge', {
    models: [small, big],
    approvedForTaskClass: () => ['small-coder', 'big-coder'],
  });
  assert.equal(r.selectedBackend, 'big-coder');
});

test('a "strongest" family takes the opposite end of the same range', () => {
  const big = model('big-coder', 'deep', { chat: true, coding: true, tools: true });
  const bigger = model('bigger-coder', 'deep', { chat: true, coding: true, tools: true });
  big.paramCount = 30;
  bigger.paramCount = 70;
  const r = resolveFamily('migra-forge', { models: [big, bigger] });
  assert.equal(r.selectedBackend, 'bigger-coder');
});

test('a family whose governed capability has NO approved model is unavailable', () => {
  // This replaced a hard-coded status gate. Swift used to be blocked by a literal
  // in the catalog; now it is unavailable because nothing is approved for
  // chat.fast — a runtime fact that follows governance instead of a constant.
  const coder = model('qwen2.5-coder:1.5b', 'fast', { chat: true, coding: true, tools: true });
  const r = resolveFamily('migra-swift', { models: [coder], governedDecision: () => undefined });
  assert.equal(r.available, false);
  assert.equal(r.basis, 'chat.fast');
  assert.match(r.unavailableReason ?? '', /no approved model for chat\.fast/);
});

test('an advertised spec alone does not make a family available — governance must approve it', () => {
  const longCtx = model('deepseek-r1:32b', 'deep', { chat: true, reasoning: true }, 131072);
  const r = resolveFamily('migra-atlas', { models: [longCtx], governedDecision: () => undefined });
  assert.equal(r.available, false, 'a large advertised context window is a spec sheet, not an approval');
  assert.equal(r.basis, 'chat.long_context');
});

test('PARTIAL and PROVEN_LIVE families still resolve — the gate is not a blanket', () => {
  const coder = model('qwen3-coder:30b', 'deep', { chat: true, coding: true, tools: true }, 262144);
  const forge = resolveFamily('migra-forge', { models: [coder], approvedForTaskClass: () => ['qwen3-coder:30b'] });
  assert.equal(forge.available, true);
});

test('the catalog is exactly as strict as the router — it cannot name a model the router refuses', () => {
  // The observed defect: the catalog advertised llama3.1:8b for Core while every
  // turn executed qwen3:8b, because the router admits only approved models under
  // enforcement and the resolver did not apply that rule.
  // Forge requires coding as well as chat and tools.
  const unapproved = model('unapproved:8b', 'balanced', { chat: true, tools: true, coding: true });
  const approved = model('approved:8b', 'balanced', { chat: true, tools: true, coding: true });
  const r = resolveFamily('migra-forge', {
    models: [unapproved, approved],
    // No grant matches, so this falls through to capability matching, which is
    // where router strictness must still apply.
    approvedForTaskClass: () => [],
    routerAccepts: (m) => m.id === 'approved:8b',
  });
  assert.equal(r.selectedBackend, 'approved:8b', 'the catalog must not name a model the router will refuse');
})

test('a governed decision is admitted BY NAME, so router strictness does not veto it', () => {
  // The router admits the gate-named model explicitly; the catalog must agree,
  // or an approved-by-a-human model would read as unavailable.
  const visionModel = model('qwen2.5vl:7b', 'balanced', { chat: true, vision: true }, 128000);
  const r = resolveFamily('migra-vision', {
    models: [visionModel],
    governedDecision: () => ({ qualified: true, modelId: 'qwen2.5vl:7b' }),
    routerAccepts: () => false, // nothing passes the generic rule
  });
  assert.equal(r.available, true);
  assert.equal(r.selectedBackend, 'qwen2.5vl:7b');
})

test('a GRANTED model is admitted by name too — strictness must not veto a governance decision', () => {
  // Regression: applying the generic manifest rule to the grant path made Forge
  // read unavailable right after it had been proven running a real workload.
  const coder = model('qwen3-coder:30b', 'deep', { chat: true, coding: true, tools: true }, 262144);
  const r = resolveFamily('migra-forge', {
    models: [coder],
    approvedForTaskClass: (tc) => (tc === 'typed-implementation' ? ['qwen3-coder:30b'] : []),
    routerAccepts: () => false, // nothing passes the generic rule
  });
  assert.equal(r.available, true);
  assert.equal(r.governed, true);
  assert.equal(r.selectedBackend, 'qwen3-coder:30b');
})
