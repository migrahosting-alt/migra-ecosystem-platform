/**
 * Image generation through Studio.
 *
 * The behaviours that only matter when something goes wrong: a pipeline whose
 * HTTP thread blocks for minutes during a cold checkpoint load, a workflow that
 * fails, and a response that is not actually a PNG. An image generator that
 * invents an answer is worse than one that is honestly down.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWorkflow,
  generateImage,
  type GenerationStage,
  type StudioConfig,
} from '../src/engine/media/studioImage.js';

const CONFIG: StudioConfig = {
  baseUrl: 'http://studio.test:8188',
  checkpoint: 'flux1-schnell-fp8.safetensors',
  steps: 4,
  width: 1024,
  height: 1024,
  timeoutMs: 60_000,
};

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

/** A Studio that accepts the job, is busy N polls, then returns an image. */
function studio(options: {
  busyPolls?: number;
  status?: string;
  images?: { filename: string }[];
  viewBody?: Buffer;
  submitStatus?: number;
} = {}) {
  const calls: string[] = [];
  let polls = 0;
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push(`${init.method ?? 'GET'} ${url}`);
    if (url.endsWith('/prompt')) {
      if (options.submitStatus && options.submitStatus !== 200) {
        return new Response('node 5 is missing an input', { status: options.submitStatus });
      }
      return Response.json({ prompt_id: 'job-1' });
    }
    if (url.includes('/history/')) {
      polls += 1;
      // The cold-load condition: Studio's HTTP thread simply does not answer.
      if (polls <= (options.busyPolls ?? 0)) throw new Error('socket hang up');
      return Response.json({
        'job-1': {
          status: { status_str: options.status ?? 'success', completed: true },
          outputs: { '7': { images: options.images ?? [{ filename: 'migrapilot_0001.png' }] } },
        },
      });
    }
    if (url.includes('/view')) {
      return new Response(options.viewBody ?? PNG, { status: 200 });
    }
    return new Response('nope', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

const run = (s: ReturnType<typeof studio>, stages: GenerationStage[] = [], cfg: StudioConfig = CONFIG) =>
  generateImage('the letter A', cfg, (x) => stages.push(x), {
    fetchImpl: s.fetchImpl,
    sleep: async () => {},
    randomSeed: () => 42,
  });

test('a generated PNG comes back as bytes, with the model named', async () => {
  const s = studio();
  const result = await run(s);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(Buffer.from(result.pngBase64, 'base64').subarray(0, 4).toString('hex'), '89504e47');
  assert.equal(result.model, 'flux1-schnell-fp8.safetensors');
  assert.equal(result.promptId, 'job-1');
});

test('a cold checkpoint load is survived, not reported as a failure', async () => {
  /*
   * Studio's HTTP thread BLOCKS while loading a checkpoint — observed for over
   * two minutes against the real instance, whose models sit on a USB disk. A
   * client that treated an unanswered poll as an error would fail every first
   * generation of the day.
   */
  const s = studio({ busyPolls: 40 });
  const stages: GenerationStage[] = [];
  const result = await run(s, stages);
  assert.equal(result.ok, true);
  assert.ok(stages.some((x) => x.kind === 'running'), 'the wait is reported, not hidden');
});

test('a workflow Studio refuses reports Studio own words', async () => {
  // "Generation failed" sends nobody anywhere. The node name is the fix.
  const s = studio({ submitStatus: 400 });
  const result = await run(s);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'rejected');
  assert.match(result.message, /node 5 is missing an input/);
});

test('a failed run is a failure, never a blank image', async () => {
  const s = studio({ status: 'error' });
  const result = await run(s);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'failed');
});

test('finishing with no image is said plainly', async () => {
  const s = studio({ images: [] });
  const result = await run(s);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'no_image');
});

test('something that is not a PNG never reaches the transcript', async () => {
  // Checked on the bytes, not on the content type Studio claims.
  const s = studio({ viewBody: Buffer.from('<html>error page</html>') });
  const result = await run(s);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /not a PNG/);
});

test('an unreachable Studio is distinguished from a broken one', async () => {
  const fetchImpl = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  const result = await generateImage('x', CONFIG, () => {}, { fetchImpl, sleep: async () => {} });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'unreachable');
    assert.match(result.message, /ECONNREFUSED/);
  }
});

test('with no endpoint configured the capability is off, not broken', async () => {
  const result = await generateImage('x', { ...CONFIG, baseUrl: undefined }, () => {}, {
    fetchImpl: (async () => {
      throw new Error('must not be called');
    }) as unknown as typeof fetch,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'not_configured');
});

test('the workflow is schnell-shaped: four steps and no guidance', () => {
  const wf = buildWorkflow('a lighthouse', CONFIG, 7) as Record<string, { inputs: Record<string, unknown> }>;
  const sampler = wf['5']!.inputs;
  assert.equal(sampler.steps, 4);
  // schnell is guidance-distilled: raising cfg degrades the image and doubles cost.
  assert.equal(sampler.cfg, 1.0);
  assert.equal(sampler.seed, 7);
  assert.equal(wf['2']!.inputs.text, 'a lighthouse');
  assert.equal(wf['1']!.inputs.ckpt_name, 'flux1-schnell-fp8.safetensors');
});
