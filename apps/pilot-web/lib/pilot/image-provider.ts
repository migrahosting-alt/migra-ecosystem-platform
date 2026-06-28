// MigraPilot — image-generation provider adapter (Phase 9.7). DISABLED by default.
// Env-gated SDXL-compatible HTTP backend. NO infra/shell/deploy/package work.
// Never logs or returns API keys. Generation is approval-gated via the tool registry + policy.
//
// Env:
//   PILOT_IMAGE_PROVIDER   "disabled" (default) | "sdxl"
//   PILOT_IMAGE_ENDPOINT   required for sdxl mode (e.g. https://host/sdxl/generate)
//   PILOT_IMAGE_API_KEY    optional bearer token (sent to the endpoint, never exposed)
//   PILOT_IMAGE_TIMEOUT_MS optional (default 60000)
//   PILOT_IMAGE_OUTPUT_BASE_URL optional base URL for returned relative image paths

const PROVIDER = (process.env.PILOT_IMAGE_PROVIDER ?? "disabled").toLowerCase();
const ENDPOINT = process.env.PILOT_IMAGE_ENDPOINT ?? "";
const API_KEY = process.env.PILOT_IMAGE_API_KEY ?? "";
const TIMEOUT_MS = Number(process.env.PILOT_IMAGE_TIMEOUT_MS) || 60000;
const OUTPUT_BASE = process.env.PILOT_IMAGE_OUTPUT_BASE_URL ?? "";

const MAX_DIM = 2048;
const MIN_DIM = 64;
const MAX_COUNT = 4;
const MAX_PROMPT = 2000;

export type ImageProviderStatus = "disabled" | "configured" | "unavailable";

export interface ImageRequest {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps?: number;
  seed?: number;
  stylePreset?: string;
  count: number;
  metadata?: Record<string, unknown>;
}

const SECRET_KEY_RE = /secret|token|password|api[_-]?key|credential/i;
const FS_PATH_RE = /(^\/|^[a-zA-Z]:[\\/]|\.\.[\\/]|[\\/])/; // absolute, drive, parent, or any path separator

export function imageProviderMode(): "disabled" | "sdxl" {
  return PROVIDER === "sdxl" ? "sdxl" : "disabled";
}

export function imageProviderStatus(): ImageProviderStatus {
  if (imageProviderMode() === "disabled") return "disabled";
  return ENDPOINT ? "configured" : "unavailable";
}

function clampDim(v: unknown, def: number): number {
  const n = Math.round(Number(v) || def);
  return Math.max(MIN_DIM, Math.min(MAX_DIM, n));
}

// Validate + normalize raw args into a safe ImageRequest. Throws on guardrail violation.
export function normalizeImageRequest(a: Record<string, unknown>): ImageRequest {
  for (const k of Object.keys(a ?? {})) {
    if (SECRET_KEY_RE.test(k)) throw new Error(`disallowed argument '${k}' (looks like a secret)`);
  }
  for (const k of ["out", "outputPath", "path", "file", "dir", "destination"]) {
    const v = a?.[k];
    if (typeof v === "string" && FS_PATH_RE.test(v)) throw new Error(`raw filesystem path not allowed in '${k}'`);
  }
  const prompt = typeof a?.prompt === "string" ? a.prompt.trim() : "";
  if (!prompt) throw new Error("prompt is required");
  if (prompt.length > MAX_PROMPT) throw new Error(`prompt too long (max ${MAX_PROMPT} chars)`);
  const count = Math.max(1, Math.min(MAX_COUNT, Math.round(Number(a?.count) || 1)));
  return {
    prompt,
    negativePrompt: typeof a?.negativePrompt === "string" ? a.negativePrompt.slice(0, MAX_PROMPT) : undefined,
    width: clampDim(a?.width, 1024),
    height: clampDim(a?.height, 1024),
    steps: a?.steps != null ? Math.max(1, Math.min(100, Math.round(Number(a.steps)))) : undefined,
    seed: a?.seed != null ? Math.round(Number(a.seed)) : undefined,
    stylePreset: typeof a?.stylePreset === "string" ? a.stylePreset.slice(0, 64) : undefined,
    count,
    metadata: a?.metadata && typeof a.metadata === "object" ? (a.metadata as Record<string, unknown>) : undefined,
  };
}

export function summarizeRequest(req: ImageRequest): string {
  const head = req.prompt.length > 80 ? req.prompt.slice(0, 80) + "…" : req.prompt;
  return `"${head}" ${req.width}x${req.height} ×${req.count}${req.stylePreset ? ` [${req.stylePreset}]` : ""}`;
}

export function imagePreview(a: Record<string, unknown>): { ok: true; normalized: ImageRequest; summary: string } | { ok: false; error: string } {
  try {
    const normalized = normalizeImageRequest(a);
    return { ok: true, normalized, summary: summarizeRequest(normalized) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "invalid request" };
  }
}

export async function imageHealth(): Promise<{ provider: string; status: ImageProviderStatus; endpointConfigured: boolean; reachable?: boolean; detail: string }> {
  const status = imageProviderStatus();
  const base = { provider: imageProviderMode(), status, endpointConfigured: !!ENDPOINT };
  if (status === "disabled") return { ...base, detail: "image provider disabled (set PILOT_IMAGE_PROVIDER=sdxl + PILOT_IMAGE_ENDPOINT to enable)" };
  if (status === "unavailable") return { ...base, detail: "sdxl selected but PILOT_IMAGE_ENDPOINT is not set" };
  let reachable: boolean | undefined;
  try {
    const headers: Record<string, string> = {};
    if (API_KEY) headers.authorization = `Bearer ${API_KEY}`;
    const res = await fetch(ENDPOINT, { method: "GET", headers, signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, 5000)) });
    reachable = res.status < 500; // any non-5xx means the host answered
  } catch {
    reachable = false;
  }
  return { ...base, reachable, detail: reachable ? "provider endpoint configured and reachable" : "provider endpoint configured but not reachable" };
}

// Submit a generation job. Returns a safe result; never throws on unavailable, never exposes keys.
export async function submitImageJob(a: Record<string, unknown>): Promise<{ ok: boolean; status: string; message: string; result?: unknown }> {
  const status = imageProviderStatus();
  if (status !== "configured") {
    return { ok: false, status, message: status === "disabled" ? "image provider is disabled" : "image provider endpoint not configured (PILOT_IMAGE_ENDPOINT unset)" };
  }
  let req: ImageRequest;
  try {
    req = normalizeImageRequest(a);
  } catch (e) {
    return { ok: false, status: "rejected", message: e instanceof Error ? e.message : "invalid request" };
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (API_KEY) headers.authorization = `Bearer ${API_KEY}`;
  try {
    const res = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(req), signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }
    if (!res.ok) return { ok: false, status: "error", message: `provider returned HTTP ${res.status}`, result: body };
    return { ok: true, status: "submitted", message: `image job submitted to provider${OUTPUT_BASE ? ` (outputs under ${OUTPUT_BASE})` : ""}`, result: body };
  } catch (e) {
    return { ok: false, status: "error", message: `provider request failed: ${e instanceof Error ? e.message : "unknown"}` };
  }
}
