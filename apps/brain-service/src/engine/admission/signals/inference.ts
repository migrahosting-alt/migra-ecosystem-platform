/**
 * What the inference server can tell us — and the one thing it can only SHOW us.
 *
 * 🚨 REACHABLE IS NOT READY. The provider's health probe is `GET /models`, which
 * answers in milliseconds with the card 100% pinned — listing models needs no GPU
 * at all. That is exactly how the Brain reported `inferenceProviders: available`,
 * accepted a turn, and then could not serve it.
 *
 * So this module reads two different KINDS of signal:
 *   - `readResidency` is metadata. Cheap, and authoritative for what is LOADED.
 *   - `probeCompute` is work. It is the only signal here about whether the card
 *     has cycles to spare, and cycles are what a competing render consumes.
 *
 * © MigraTeck LLC.
 */

import { getJson } from './http.js';

export interface ResidencyReading {
  /** Undefined means the server did not answer — an outage, not an empty card. */
  reachable: boolean;
  residentModels: string[];
  /** Exact, unlike any VRAM figure ComfyUI reports. */
  residentVramBytes?: number;
}

/** `/v1` is the OpenAI-compatible surface; the native endpoints sit beside it. */
export function nativeBase(providerBaseUrl: string | undefined): string {
  return (providerBaseUrl ?? '').replace(/\/v1\/?$/, '');
}

export async function readResidency(
  base: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<ResidencyReading> {
  const ps = await getJson(`${base}/api/ps`, timeoutMs, fetchImpl);
  if (!ps) return { reachable: false, residentModels: [] };
  const models = Array.isArray(ps.models) ? (ps.models as Array<Record<string, unknown>>) : [];
  return {
    reachable: true,
    residentModels: models.map((m) => String(m?.name ?? '')).filter(Boolean),
    residentVramBytes: models.reduce((n, m) => n + (Number(m?.size_vram) || 0), 0),
  };
}

/**
 * Is `modelId` among the models reported RESIDENT?
 *
 * Compared on the tag-stripped name as well as in full: a provider id and an Ollama
 * tag are not guaranteed to be spelled identically ("qwen3:8b" vs "qwen3"), and a
 * spelling mismatch would invent a cold start on a warm model.
 *
 * Returns false when `resident` is undefined — an unmeasured probe is not a warm
 * model, and callers use this to decide whether to TELL a user a load is happening.
 */
export function isModelResident(resident: readonly string[] | undefined, modelId: string): boolean {
  if (!resident || !modelId) return false;
  const bare = (n: string): string => n.split(':')[0]!.toLowerCase();
  const want = modelId.toLowerCase();
  return resident.some((m) => m.toLowerCase() === want || bare(m) === bare(modelId));
}

export interface ComputeReading {
  ok: boolean;
  ms: number;
}

/**
 * Ask the card to actually DO something, briefly.
 *
 * One token from a model that is already resident needs no load, no context and no
 * scheduling. If that cannot come back in seconds, the card is not available to
 * this turn no matter what the VRAM figures say.
 *
 * `keep_alive` is deliberately omitted so the probe never changes how long the
 * model stays resident — measuring must not perturb what it measures.
 */
export async function probeCompute(
  base: string,
  model: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<ComputeReading> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: '.', stream: false, options: { num_predict: 1 } }),
      signal: controller.signal,
    });
    return { ok: res.ok, ms: Date.now() - started };
  } catch {
    return { ok: false, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
