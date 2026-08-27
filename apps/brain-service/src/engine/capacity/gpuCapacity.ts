/**
 * Can this GPU actually take work right now?
 *
 * 🚨 REACHABLE IS NOT READY. The provider's health probe is `GET /models`, which
 * answers in milliseconds with the card 100% pinned — listing models needs no
 * GPU at all. So the Brain reported `inferenceProviders: available`, accepted
 * the turn, and then could not serve it. Measured, same conversation and
 * question and model: no answer at all in over five minutes at 24.0/24.5 GB and
 * 100% util, versus "Red" in 15 seconds at 5.7 GB and 11%.
 *
 * Accepting work the system cannot execute is the defect. This module answers
 * the different question — is there CAPACITY — from signals that move when the
 * GPU actually moves.
 *
 * WHAT EACH SIGNAL IS WORTH (measured 2026-08-27, not assumed):
 *
 *  - ComfyUI `/queue` — authoritative for "a render is holding the card". This
 *    is the exact workload that starved chat.
 *  - Ollama `/api/ps` — authoritative for which models are RESIDENT and how much
 *    VRAM each holds. A resident model can answer immediately: measured 0.29 s
 *    warm against 5.9 s cold.
 *  - ComfyUI `/system_stats` `vram_free` — DIRECTIONAL ONLY, and measurably
 *    optimistic. It moves with real allocation (24.4 GB -> 13.9 GB when a
 *    13.5 GB model loaded) but it is not `total - used`. Under a genuinely
 *    pinned card — 23.5 of 24.0 GiB allocated, ~1 GB actually free — it still
 *    reported **14.2 GB free**. Trusting it alone would have called that card
 *    ready.
 *
 * So free VRAM is the MINIMUM of two estimates: ComfyUI's number, and
 * `total - (VRAM the inference server says its resident models hold)`, which is
 * exact. Whichever is more pessimistic wins — if either says there is no room,
 * there is no room.
 *
 * This module DECIDES NOTHING ABOUT SCHEDULING. It does not evict models, does
 * not touch ComfyUI, and does not arbitrate between workloads. It reports.
 */

/** Coarse enough to act on, honest enough to show a user. */
export type CapacityState = 'ready' | 'busy' | 'unavailable' | 'unknown';

export interface CapacitySignals {
  /** ComfyUI jobs executing now. Non-zero means the card is committed. */
  comfyRunning?: number;
  comfyPending?: number;
  /** Coarse headroom hint. See the caveat above — not ground truth. */
  vramFreeBytes?: number;
  vramTotalBytes?: number;
  /** Models the inference server currently holds in VRAM. */
  residentModels?: string[];
  /** VRAM those resident models hold. Exact, unlike the ComfyUI figure. */
  residentVramBytes?: number;
  /** The pessimistic free-VRAM estimate the decision actually uses. */
  effectiveFreeBytes?: number;
  /** Whether the model this turn needs is already loaded. */
  modelResident?: boolean;
  /** Probes that could not be reached, by name. */
  unreachable?: string[];
}

export interface CapacityReading {
  state: CapacityState;
  /** What the user is told, when they need to be told anything. */
  message?: string;
  signals: CapacitySignals;
}

/*
 * The sentence a waiting user gets. It says three things on purpose: what is
 * happening, that their request has NOT started, and that nothing was lost.
 * "Please wait" would imply progress that is not occurring.
 */
export const BUSY_MESSAGE =
  'The AI vision engine is busy with another task on the graphics card, so your request has not '
  + 'started yet. Nothing was lost — send it again in a moment and it will run.';

export const UNAVAILABLE_MESSAGE =
  'The AI engine is not reachable right now, so your request has not started. Nothing was lost.';

/**
 * Below this much free VRAM a cold model load is not worth starting.
 *
 * Sized from the measured vision model (13.5 GB resident). The check only
 * applies when the model is NOT already resident, because a loaded model needs
 * no headroom to answer.
 */
const COLD_LOAD_HEADROOM_BYTES = 14 * 1024 * 1024 * 1024;

export interface CapacityProbeDeps {
  /** Ollama-compatible base, WITHOUT the /v1 suffix. */
  providerBaseUrl?: string;
  /** ComfyUI base URL. */
  studioBaseUrl?: string;
  /** The model this turn intends to use, if known. */
  model?: string;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  /** Probe budget. Deliberately small: this gates a user-facing turn. */
  timeoutMs?: number;
}

async function getJson(
  url: string, timeoutMs: number, fetchImpl: typeof fetch,
): Promise<any | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the capacity signals and classify them.
 *
 * 🚨 FAILS OPEN. When the probes cannot be read the state is `unknown` and the
 * caller proceeds — a broken probe must never be the reason chat stops working.
 * The bounded first-token deadline is what protects an `unknown` turn, which is
 * why that bound is not optional.
 */
export async function probeGpuCapacity(deps: CapacityProbeDeps): Promise<CapacityReading> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 2_500;
  const unreachable: string[] = [];

  // `/v1` is the OpenAI-compatible surface; the native endpoints sit beside it.
  const ollamaBase = (deps.providerBaseUrl ?? '').replace(/\/v1\/?$/, '');
  const studioBase = (deps.studioBaseUrl ?? '').replace(/\/$/, '');

  const [ps, queue, stats] = await Promise.all([
    ollamaBase ? getJson(`${ollamaBase}/api/ps`, timeoutMs, fetchImpl) : undefined,
    studioBase ? getJson(`${studioBase}/queue`, timeoutMs, fetchImpl) : undefined,
    studioBase ? getJson(`${studioBase}/system_stats`, timeoutMs, fetchImpl) : undefined,
  ]);

  if (ollamaBase && !ps) unreachable.push('inference');
  if (studioBase && !queue) unreachable.push('studio');

  const residentModels: string[] = Array.isArray(ps?.models)
    ? ps.models.map((m: any) => String(m?.name ?? '')).filter(Boolean)
    : [];
  const residentVramBytes: number | undefined = Array.isArray(ps?.models)
    ? ps.models.reduce((n: number, m: any) => n + (Number(m?.size_vram) || 0), 0)
    : undefined;
  const modelResident = deps.model
    ? residentModels.some((n) => n === deps.model || n.startsWith(`${deps.model}:`))
    : undefined;

  const device = Array.isArray(stats?.devices) ? stats.devices[0] : undefined;
  const signals: CapacitySignals = {
    ...(queue ? {
      comfyRunning: Array.isArray(queue.queue_running) ? queue.queue_running.length : 0,
      comfyPending: Array.isArray(queue.queue_pending) ? queue.queue_pending.length : 0,
    } : {}),
    ...(typeof device?.vram_free === 'number' ? { vramFreeBytes: device.vram_free } : {}),
    ...(typeof device?.vram_total === 'number' ? { vramTotalBytes: device.vram_total } : {}),
    ...(ps ? { residentModels } : {}),
    ...(residentVramBytes !== undefined ? { residentVramBytes } : {}),
    ...(modelResident !== undefined ? { modelResident } : {}),
    ...(unreachable.length ? { unreachable } : {}),
  };

  // The inference server itself being unreachable is not contention, it is an
  // outage, and saying "busy" would send the user back to retry a thing that
  // cannot work yet.
  if (ollamaBase && !ps) {
    return { state: 'unavailable', message: UNAVAILABLE_MESSAGE, signals };
  }

  // Nothing readable at all: proceed, protected by the bounded wait.
  if (!ps && !queue) return { state: 'unknown', signals };

  // A resident model answers from VRAM it already holds — measured 0.29 s warm.
  // This is checked BEFORE the render check on purpose: a ComfyUI job running
  // beside an already-loaded model is contention, not a blockade, and refusing
  // there would deny work the card can actually do.
  if (signals.modelResident) return { state: 'ready', signals };

  // A render owns the card, and this turn would need a cold load behind it.
  if ((signals.comfyRunning ?? 0) > 0) {
    return { state: 'busy', message: BUSY_MESSAGE, signals };
  }

  // Not resident, and not enough headroom to bring it in. The estimate is the
  // more pessimistic of the two available signals — see the header for why the
  // ComfyUI figure cannot be trusted on its own.
  const byResidency = signals.vramTotalBytes !== undefined && residentVramBytes !== undefined
    ? signals.vramTotalBytes - residentVramBytes
    : undefined;
  const estimates = [signals.vramFreeBytes, byResidency].filter(
    (n): n is number => typeof n === 'number',
  );
  if (estimates.length > 0) {
    const effectiveFreeBytes = Math.min(...estimates);
    signals.effectiveFreeBytes = effectiveFreeBytes;
    if (effectiveFreeBytes < COLD_LOAD_HEADROOM_BYTES) {
      return { state: 'busy', message: BUSY_MESSAGE, signals };
    }
  }

  return { state: 'ready', signals };
}

/**
 * Should this reading stop the turn before any model request is sent?
 *
 * Only `busy` and `unavailable` do. `unknown` deliberately proceeds — see the
 * fail-open note above.
 */
export function shouldRefuse(reading: CapacityReading): boolean {
  return reading.state === 'busy' || reading.state === 'unavailable';
}
