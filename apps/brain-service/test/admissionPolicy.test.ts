// The admission POLICY, exercised as data.
//
// These were network tests: every case stubbed HTTP to reach a branch three layers
// down. The policy is pure now, so each case states the signals directly and asserts
// the verdict — which is what they were always really about. A branch that needs a
// fetch double to reach is a branch nobody reads.
//
// Every scenario here is a MEASUREMENT, not a hypothesis. Where a number appears,
// it was observed on the real card; the comments say when.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classify, applyComputeProbe, shouldRefuse } from '../src/engine/admission/policy.js';
import { isModelResident } from '../src/engine/admission/signals/inference.js';
import { DEFAULT_THRESHOLDS } from '../src/engine/admission/thresholds.js';
import { BUSY_MESSAGE, UNAVAILABLE_MESSAGE, UNRESPONSIVE_MESSAGE } from '../src/engine/admission/messages.js';
import type { PolicyInput } from '../src/engine/admission/policy.js';

const GB = 1024 * 1024 * 1024;
const thresholds = DEFAULT_THRESHOLDS;

const reachableStudio = (over: Partial<{ running: number; pending: number; vramFreeBytes: number; vramTotalBytes: number }> = {}) => ({
  reachable: true as const, running: 0, pending: 0, vramFreeBytes: 24.4e9, vramTotalBytes: 25.8e9, ...over,
});
const residency = (models: Array<{ name: string; vram: number }>) => ({
  reachable: true as const,
  residentModels: models.map((m) => m.name),
  residentVramBytes: models.reduce((n, m) => n + m.vram, 0),
});
const decide = (input: Omit<PolicyInput, 'thresholds'>) => classify({ ...input, thresholds });

test('a free card with room is ready', () => {
  const step = decide({ residency: residency([]), studio: reachableStudio(), model: 'qwen2.5vl:7b' });
  assert.equal(step.kind, 'decided');
  assert.equal(step.kind === 'decided' && step.reading.state, 'ready');
  assert.equal(step.kind === 'decided' && step.reading.reason, 'headroom-available');
});

test('a running render makes a COLD-LOAD turn busy, not ready', () => {
  const step = decide({
    residency: residency([]), studio: reachableStudio({ running: 1, vramFreeBytes: 1.2e9 }), model: 'qwen2.5vl:7b',
  });
  assert.equal(step.kind === 'decided' && step.reading.state, 'busy');
  assert.equal(step.kind === 'decided' && step.reading.reason, 'render-holds-card');
  assert.equal(step.kind === 'decided' && step.reading.message, BUSY_MESSAGE);
});

/* ── residency vs. availability ───────────────────────────────────────────────
 * Replaces a case asserting "an ALREADY-RESIDENT model stays ready even while a
 * render runs". That was a hypothesis, FALSIFIED 2026-09-03: qwen2.5-coder:14b was
 * resident at 15.3 GB while a render held the card at 100% util, and a completion
 * did not return in 180 s — from the Brain's host and from the workstation. Health
 * reported `ready` throughout. Its real concern — do not refuse work the card can
 * still do — is kept, and now settled by asking rather than assuming. */

test('a resident model beside a render does not decide alone — it asks the card', () => {
  const step = decide({
    residency: residency([{ name: 'qwen2.5-coder:14b', vram: 15.3e9 }]),
    studio: reachableStudio({ running: 1, vramFreeBytes: 1.2e9 }),
    model: 'qwen2.5-coder:14b',
  });
  assert.equal(step.kind, 'needs-compute-probe', 'residency alone must not settle this');
});

test('...READY when the card answers, BUSY when it does not', () => {
  const step = decide({
    residency: residency([{ name: 'qwen2.5-coder:14b', vram: 15.3e9 }]),
    studio: reachableStudio({ running: 1 }), model: 'qwen2.5-coder:14b',
  });
  assert.equal(step.kind, 'needs-compute-probe');
  if (step.kind !== 'needs-compute-probe') return;

  const answered = applyComputeProbe(step.signals, { ok: true, ms: 380 });
  assert.equal(answered.state, 'ready', 'work the card can still do must not be refused');
  assert.equal(answered.reason, 'compute-verified');
  assert.equal(answered.signals.computeProbeMs, 380);

  const starved = applyComputeProbe(step.signals, { ok: false, ms: 6_000 });
  assert.equal(starved.state, 'busy');
  assert.equal(starved.reason, 'compute-starved');
  assert.equal(shouldRefuse(starved), true, 'and refused fast, not after 240s');
});

test('ComfyUI going silent is not evidence of an idle card', () => {
  // Its /queue stopped answering BECAUSE a long node execution was blocking the
  // event loop — the authoritative signal vanished exactly when it mattered.
  const step = decide({
    residency: residency([{ name: 'qwen2.5-coder:14b', vram: 15.3e9 }]),
    studio: { reachable: false }, model: 'qwen2.5-coder:14b',
  });
  assert.equal(step.kind, 'needs-compute-probe');
  assert.ok(step.kind === 'needs-compute-probe' && step.signals.unreachable?.includes('studio'));
});

test('the fast path is untouched: nothing competing means no probe is requested', () => {
  const step = decide({
    residency: residency([{ name: 'qwen2.5vl:7b', vram: 13.5e9 }]),
    studio: reachableStudio(), model: 'qwen2.5vl:7b',
  });
  assert.equal(step.kind, 'decided', 'an idle card must not pay for a probe on every turn');
  assert.equal(step.kind === 'decided' && step.reading.reason, 'resident-idle');
});

test('no headroom for a cold load is busy', () => {
  const step = decide({
    residency: residency([]), studio: reachableStudio({ vramFreeBytes: 1.2e9 }), model: 'big:70b',
  });
  assert.equal(step.kind === 'decided' && step.reading.reason, 'insufficient-vram');
});

test('an unreachable inference server is unavailable, not busy', () => {
  const step = decide({ residency: { reachable: false, residentModels: [] }, studio: reachableStudio() });
  assert.equal(step.kind === 'decided' && step.reading.state, 'unavailable');
  assert.equal(step.kind === 'decided' && step.reading.message, UNAVAILABLE_MESSAGE);
});

test('unreadable probes are unknown and do NOT refuse', () => {
  const step = decide({});
  assert.equal(step.kind === 'decided' && step.reading.state, 'unknown');
  assert.equal(step.kind === 'decided' && step.reading.reason, 'signals-unreadable');
  assert.equal(step.kind === 'decided' && shouldRefuse(step.reading), false,
    'a monitoring outage must never become a service outage');
});

/*
 * THE MEASURED CASE THAT NEARLY GOT THROUGH.
 *
 * A genuinely pinned card — 23.2 GB of models resident, ~1 GB actually free — and
 * ComfyUI still reported 14.2 GB free. Trusting that number alone calls this card
 * ready and submits a turn it cannot serve. Residency arithmetic is exact, so the
 * pessimistic estimate decides.
 */
test('a pinned card is busy even when ComfyUI claims 14.2 GB free', () => {
  const step = decide({
    residency: residency([{ name: 'other:34b', vram: 23.2e9 }]),
    studio: reachableStudio({ vramFreeBytes: 14.2e9, vramTotalBytes: 24.0e9 }),
    model: 'qwen2.5vl:7b',
  });
  assert.equal(step.kind === 'decided' && step.reading.state, 'busy');
  assert.equal(step.kind === 'decided' && step.reading.reason, 'insufficient-vram');
  assert.ok((step.kind === 'decided' ? step.reading.signals.effectiveFreeBytes! : 0) < 14 * GB);
});

test('the optimistic figure still wins when IT is the lower one', () => {
  const step = decide({
    residency: residency([{ name: 'small:1b', vram: 1e9 }]),
    studio: reachableStudio({ vramFreeBytes: 2e9, vramTotalBytes: 25.8e9 }),
    model: 'qwen2.5vl:7b',
  });
  assert.equal(step.kind === 'decided' && step.reading.signals.effectiveFreeBytes, 2e9,
    'whichever estimate is more pessimistic decides, from either source');
});

test('residency is read from evidence, and absence of evidence is not absence of the model', () => {
  assert.equal(isModelResident(['qwen3:8b'], 'qwen3:8b'), true);
  assert.equal(isModelResident(['qwen3:8b'], 'qwen3'), true, 'a tag spelling must not invent a cold start');
  assert.equal(isModelResident(['qwen3:8b'], 'llama3.1:8b'), false);
  assert.equal(isModelResident(undefined, 'qwen3:8b'), false, 'unmeasured is not warm');
  assert.equal(isModelResident([], 'qwen3:8b'), false);
});

test('every reason is reachable and distinct', () => {
  // A reason nothing can produce is dead telemetry; two paths sharing one reason
  // makes an operator unable to tell them apart. Both are worth pinning.
  const seen = new Set<string>();
  seen.add((decide({ residency: residency([]), studio: reachableStudio(), model: 'm' }) as never as { reading: { reason: string } }).reading.reason);
  seen.add((decide({ residency: residency([]), studio: reachableStudio({ running: 1 }), model: 'm' }) as never as { reading: { reason: string } }).reading.reason);
  seen.add((decide({ residency: { reachable: false, residentModels: [] } }) as never as { reading: { reason: string } }).reading.reason);
  seen.add((decide({}) as never as { reading: { reason: string } }).reading.reason);
  seen.add((decide({ residency: residency([{ name: 'm:1b', vram: 1e9 }]), studio: reachableStudio(), model: 'm:1b' }) as never as { reading: { reason: string } }).reading.reason);
  seen.add(applyComputeProbe({}, { ok: true, ms: 1 }).reason);
  seen.add(applyComputeProbe({}, { ok: false, ms: 1 }).reason);
  seen.add((decide({ residency: residency([{ name: 'o:34b', vram: 23.2e9 }]), studio: reachableStudio({ vramFreeBytes: 1e9 }), model: 'm' }) as never as { reading: { reason: string } }).reading.reason);
  assert.equal(seen.size, 8, `expected 8 distinct reasons, saw ${[...seen].sort().join(', ')}`);
});

/* ── what a failed probe is, and is not, evidence of ─────────────────────────
 *
 * MEASURED 2026-09-04. Ollama unloads an idle model, so the first request after a
 * pause pays a cold load: 5.08 s, 11.8 s, and 55 s straight after a machine
 * restart. The original 6 s probe deadline sat INSIDE that range, so the gate
 * refused turns the card would have served — and told the user the GPU was busy
 * when it was merely loading. The deadline is 20 s now, sized from those numbers.
 *
 * The second half is what the refusal SAYS. A failed probe proves the card did not
 * produce a token in time; it does not prove what was using it. The probe also runs
 * when ComfyUI is unreachable — which is exactly what a STOPPED ComfyUI looks like. */

test('a failed probe with a CONFIRMED render says another task holds the card', () => {
  const step = decide({
    residency: residency([{ name: 'coder:14b', vram: 15.3e9 }]),
    studio: reachableStudio({ running: 1 }), model: 'coder:14b',
  });
  assert.equal(step.kind, 'needs-compute-probe');
  if (step.kind !== 'needs-compute-probe') return;
  const r = applyComputeProbe(step.signals, { ok: false, ms: 20_000 });
  assert.equal(r.message, BUSY_MESSAGE, 'a seen render earns the stronger claim');
});

test('a failed probe with NO confirmed render claims only what it observed', () => {
  // Studio unreachable — indistinguishable from ComfyUI being stopped. Telling the
  // user the card is "busy with another task" here sent someone hunting for a
  // workload that had already been shut down.
  const step = decide({
    residency: residency([{ name: 'coder:14b', vram: 15.3e9 }]),
    studio: { reachable: false }, model: 'coder:14b',
  });
  assert.equal(step.kind, 'needs-compute-probe');
  if (step.kind !== 'needs-compute-probe') return;
  const r = applyComputeProbe(step.signals, { ok: false, ms: 20_000 });
  assert.equal(r.state, 'busy');
  assert.equal(r.message, UNRESPONSIVE_MESSAGE);
  assert.doesNotMatch(String(r.message), /another task/, 'no unevidenced claim about a competing workload');
});

test('the probe deadline clears a normal cold load', () => {
  // 5.08 s and 11.8 s were measured cold loads. A deadline inside that range
  // refuses turns the card would have served.
  assert.ok(
    DEFAULT_THRESHOLDS.computeTimeoutMs > 11_800,
    `probe deadline ${DEFAULT_THRESHOLDS.computeTimeoutMs}ms must clear a measured 11.8s cold load`,
  );
  // ...and still beat the provider deadline it exists to prevent, by a wide margin.
  assert.ok(DEFAULT_THRESHOLDS.computeTimeoutMs <= 30_000, 'but must stay far below the 240s provider deadline');
});
