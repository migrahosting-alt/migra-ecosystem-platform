// The agent's memory of its own intent.
//
// The loop hands the model a fresh prompt each step, so across a long task it
// had no record of what it set out to do. Given the owner's fourteen-part Sprint
// 1 order it wandered — repeated searches, duplicate calls, no progress — and
// finished with a summary instead of the work. Plan state lives in the LOOP so
// it survives every step and is rendered back into every prompt.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyPlanUpdate,
  renderPlan,
  runEngineerTask,
  type EngineerEvent,
  type EngineerToolInfo,
  type PlanStep,
} from '../src/engine/engineerRuntime.js';

const TOOLS: EngineerToolInfo[] = [
  { id: 'workspace.list', description: 'list', readOnly: true, inputHint: '{}' },
  { id: 'fs.proposeChangeset', description: 'propose', readOnly: false, inputHint: '{}' },
  { id: 'plan.update', description: 'plan', readOnly: true, inputHint: '{}' },
];

function harness(replies: string[]): { deps: Parameters<typeof runEngineerTask>[0]; prompts: string[]; calls: string[] } {
  const prompts: string[] = [];
  const calls: string[] = [];
  let i = 0;
  return {
    prompts,
    calls,
    deps: {
      complete: async (prompt: string) => {
        prompts.push(prompt);
        return replies[Math.min(i++, replies.length - 1)]!;
      },
      executeTool: async (tool: string) => {
        calls.push(tool);
        return { ok: true };
      },
      tools: TOOLS,
    },
  };
}

async function drain(gen: AsyncGenerator<EngineerEvent>): Promise<EngineerEvent[]> {
  const out: EngineerEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

test('setting a plan records the steps, unticked', () => {
  const plan = applyPlanUpdate([], { steps: ['audit the repo', 'build the route', 'run the tests'] });
  assert.deepEqual(plan, [
    { text: 'audit the repo', done: false },
    { text: 'build the route', done: false },
    { text: 'run the tests', done: false },
  ]);
});

test('completing marks by 1-based index and leaves the rest alone', () => {
  const plan = applyPlanUpdate([{ text: 'a', done: false }, { text: 'b', done: false }], { complete: [1] });
  assert.deepEqual(plan.map((s) => s.done), [true, false]);
});

test('a plan is bounded and junk input never throws', () => {
  const many = applyPlanUpdate([], { steps: Array.from({ length: 40 }, (_, i) => `step ${i}`) });
  assert.equal(many.length, 12, 'bounded');
  assert.deepEqual(applyPlanUpdate([], { steps: [1, null, '  ', 'real'] as unknown }), [{ text: 'real', done: false }]);
  assert.deepEqual(applyPlanUpdate([], undefined), []);
  assert.deepEqual(applyPlanUpdate([{ text: 'a', done: false }], { complete: 'nonsense' as unknown }).length, 1);
});

test('the rendering shows progress at a glance', () => {
  const plan: PlanStep[] = [{ text: 'audit', done: true }, { text: 'build', done: false }];
  const out = renderPlan(plan);
  assert.match(out, /PLAN \(1\/2 done\)/);
  assert.match(out, /\[x\] 1\. audit/);
  assert.match(out, /\[ \] 2\. build/);
});

test('the plan is fed back to the model on the NEXT step', async () => {
  const h = harness([
    '{"action":{"tool":"plan.update","input":{"steps":["audit the repo","build the demo route"]}}}',
    '{"action":{"tool":"workspace.list","input":{"rootPath":"/w"}}}',
    '{"final":"Listed the repo and proposed nothing yet; the plan records what remains."}',
  ]);
  const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'audit then build' }));

  // The model must SEE its plan again, otherwise it has no memory of intent.
  assert.match(h.prompts[1]!, /PLAN \(0\/2 done\)/);
  assert.match(h.prompts[1]!, /\[ \] 1\. audit the repo/);
  const note = events.find((e) => e.type === 'note' && (e as { kind: string }).kind === 'plan');
  assert.ok(note, 'the plan is surfaced to the user too');
  assert.deepEqual(h.calls, ['workspace.list'], 'plan.update is loop state, never dispatched to a tool');
});

test('ticking a step off is reflected in the next prompt', async () => {
  const h = harness([
    '{"action":{"tool":"plan.update","input":{"steps":["audit","build"]}}}',
    '{"action":{"tool":"plan.update","input":{"complete":[1]}}}',
    '{"final":"Audit done; the build step remains and is recorded in the plan."}',
  ]);
  await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'audit then build' }));
  assert.match(h.prompts[2]!, /PLAN \(1\/2 done\)/);
  assert.match(h.prompts[2]!, /\[x\] 1\. audit/);
});

test('recording a plan counts as progress, so it never trips the stall detector', async () => {
  const h = harness([
    '{"action":{"tool":"plan.update","input":{"steps":["one","two"]}}}',
    '{"action":{"tool":"plan.update","input":{"complete":[1]}}}',
    '{"action":{"tool":"plan.update","input":{"complete":[2]}}}',
    '{"final":"Both planned steps are now marked complete in the plan above."}',
  ]);
  const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'do two things' }));
  assert.equal(events.find((e) => e.type === 'error'), undefined, 'planning is not a stall');
});

test('the prompt tells the model to plan first, and that a plan is not the deliverable', async () => {
  const h = harness(['{"final":"a sufficiently long direct answer for the agent to accept it"}']);
  await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'hi' }));
  assert.match(h.prompts[0]!, /call plan\.update FIRST/);
  assert.match(h.prompts[0]!, /never finish with only a plan/);
});
