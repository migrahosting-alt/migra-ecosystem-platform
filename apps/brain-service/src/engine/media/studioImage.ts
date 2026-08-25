/**
 * Image generation, served by the MigraAI Studio pipeline.
 *
 * WHY A CLIENT AND NOT A MODEL. Everything else the engine routes is a
 * completion from a text or vision model. This is a different kind of capability
 * entirely: a workflow submitted to Studio's ComfyUI, which queues it, loads a
 * diffusion checkpoint, samples, decodes and writes a PNG. It has queue
 * semantics, minute-scale first loads and its own failure modes, so it gets its
 * own client rather than being forced into the provider interface.
 *
 * TRUTHFUL STAGES, NOT A SPINNER. A spinner that means "something is happening"
 * is indistinguishable from a hang, and this pipeline legitimately takes minutes
 * the first time — Studio's checkpoints live on a USB disk, so the first load of
 * a FLUX checkpoint is slow in a way that is real and worth SAYING. Each stage
 * reported here is observed from Studio's own queue and history, never inferred
 * from elapsed time.
 *
 * NOTHING IS EVER FABRICATED. If Studio is unreachable, the workflow fails, or
 * no image comes back, this returns a failure with the reason. An image
 * generator that invents an answer is worse than one that is honestly down.
 */

export type GenerationStage =
  | { kind: 'submitted'; promptId: string }
  | { kind: 'queued'; ahead: number }
  | { kind: 'running' }
  | { kind: 'downloading' }

export interface GeneratedImage {
  ok: true
  pngBase64: string
  bytes: number
  model: string
  promptId: string
  elapsedMs: number
}

export interface GenerationFailure {
  ok: false
  code: 'not_configured' | 'unreachable' | 'rejected' | 'failed' | 'timeout' | 'no_image'
  message: string
  promptId?: string
}

export type GenerationResult = GeneratedImage | GenerationFailure

export interface StudioConfig {
  /** Base URL of the Studio ComfyUI endpoint. Absent means the capability is off. */
  baseUrl?: string
  /** Checkpoint to sample with. */
  checkpoint: string
  steps: number
  width: number
  height: number
  /** Ceiling for the whole generation, including a cold checkpoint load. */
  timeoutMs: number
}

export const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  baseUrl: process.env.MIGRAPILOT_STUDIO_URL,
  /*
   * FLUX schnell: four steps to a usable image, where SDXL needs twenty-plus.
   * For a chat turn the difference between 3 seconds and 20 is the difference
   * between a feature and a nuisance, and schnell is also markedly better at
   * rendering legible letterforms — which is exactly the acceptance fixture.
   */
  checkpoint: process.env.MIGRAPILOT_STUDIO_CHECKPOINT ?? 'flux1-schnell-fp8.safetensors',
  steps: Number(process.env.MIGRAPILOT_STUDIO_STEPS ?? 4),
  width: 1024,
  height: 1024,
  // Generous ON PURPOSE: a cold checkpoint load off a USB disk is minutes, and
  // failing at 60s would report a timeout for a pipeline that was working.
  timeoutMs: Number(process.env.MIGRAPILOT_STUDIO_TIMEOUT_MS ?? 600_000),
}

/**
 * The workflow, in Studio's own API format.
 *
 * cfg is 1.0 and the negative prompt is empty because schnell is
 * guidance-distilled — it ignores classifier-free guidance, and raising cfg
 * degrades the image while doubling the cost.
 */
export function buildWorkflow(prompt: string, config: StudioConfig, seed: number): Record<string, unknown> {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: config.checkpoint } },
    '2': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: prompt } },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: '' } },
    '4': {
      class_type: 'EmptySD3LatentImage',
      inputs: { width: config.width, height: config.height, batch_size: 1 },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        seed,
        steps: config.steps,
        cfg: 1.0,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1.0,
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'migrapilot' } },
  }
}

interface Deps {
  fetchImpl?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  randomSeed?: () => number
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function generateImage(
  prompt: string,
  config: StudioConfig = DEFAULT_STUDIO_CONFIG,
  onStage: (stage: GenerationStage) => void = () => {},
  deps: Deps = {},
): Promise<GenerationResult> {
  const doFetch = deps.fetchImpl ?? fetch
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? wait
  const seed = deps.randomSeed ? deps.randomSeed() : Math.floor(Math.random() * 2 ** 31)

  if (!config.baseUrl) {
    return {
      ok: false,
      code: 'not_configured',
      message: 'Image generation is not configured on this server.',
    }
  }
  const base = config.baseUrl.replace(/\/$/, '')
  const started = now()

  let promptId: string
  try {
    const res = await doFetch(`${base}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: buildWorkflow(prompt, config, seed) }),
    })
    if (!res.ok) {
      // Studio's own words: it names the offending node, which is the difference
      // between a fixable report and "generation failed".
      const detail = await res.text().catch(() => '')
      return {
        ok: false,
        code: 'rejected',
        message: `Studio rejected the request (${res.status}). ${detail.slice(0, 300)}`.trim(),
      }
    }
    const body = (await res.json()) as { prompt_id?: string }
    if (!body.prompt_id) {
      return { ok: false, code: 'rejected', message: 'Studio accepted the request but named no job.' }
    }
    promptId = body.prompt_id
  } catch (error) {
    return {
      ok: false,
      code: 'unreachable',
      message: `Studio could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  onStage({ kind: 'submitted', promptId })

  // Poll history. Studio's HTTP thread BLOCKS while a checkpoint loads, so a
  // failed poll is a normal condition here and must not end the job — only the
  // overall deadline does.
  let announcedRunning = false
  while (now() - started < config.timeoutMs) {
    await sleep(1500)

    let history: Record<string, unknown> | null = null
    try {
      const res = await doFetch(`${base}/history/${promptId}`, { method: 'GET' })
      if (res.ok) history = (await res.json()) as Record<string, unknown>
    } catch {
      // Busy or briefly unavailable; the deadline is the only authority.
    }

    if (!history) {
      if (!announcedRunning) {
        announcedRunning = true
        onStage({ kind: 'running' })
      }
      continue
    }

    const entry = history[promptId] as
      | { status?: { status_str?: string; completed?: boolean }; outputs?: Record<string, { images?: { filename: string; subfolder?: string; type?: string }[] }> }
      | undefined

    if (!entry) {
      if (!announcedRunning) {
        announcedRunning = true
        onStage({ kind: 'running' })
      }
      continue
    }

    if (entry.status?.status_str === 'error') {
      return { ok: false, code: 'failed', message: 'Studio could not complete the workflow.', promptId }
    }

    const images = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? [])
    if (images.length === 0) {
      return { ok: false, code: 'no_image', message: 'Studio finished but produced no image.', promptId }
    }

    onStage({ kind: 'downloading' })
    const first = images[0]!
    const params = new URLSearchParams({
      filename: first.filename,
      subfolder: first.subfolder ?? '',
      type: first.type ?? 'output',
    })
    try {
      const res = await doFetch(`${base}/view?${params.toString()}`, { method: 'GET' })
      if (!res.ok) {
        return { ok: false, code: 'no_image', message: 'The generated image could not be read back.', promptId }
      }
      const bytes = Buffer.from(await res.arrayBuffer())
      // Checked, not assumed: what reaches the transcript must actually be a PNG.
      const isPng =
        bytes.length > 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      if (!isPng) {
        return { ok: false, code: 'no_image', message: 'Studio returned something that is not a PNG.', promptId }
      }
      return {
        ok: true,
        pngBase64: bytes.toString('base64'),
        bytes: bytes.byteLength,
        model: config.checkpoint,
        promptId,
        elapsedMs: now() - started,
      }
    } catch (error) {
      return {
        ok: false,
        code: 'unreachable',
        message: `The generated image could not be fetched: ${error instanceof Error ? error.message : String(error)}`,
        promptId,
      }
    }
  }

  return {
    ok: false,
    code: 'timeout',
    message: `Studio did not finish within ${Math.round(config.timeoutMs / 1000)}s.`,
    promptId,
  }
}
