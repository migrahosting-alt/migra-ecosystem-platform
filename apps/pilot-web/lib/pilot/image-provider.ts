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

// ---- Response compatibility (Phase 9.8) ------------------------------------
// A stable internal image shape, independent of whatever the provider returns.
export interface NormalizedImage {
  url?: string;
  base64?: string;
  mimeType?: string;
  seed?: number;
  metadata?: Record<string, unknown>;
}

export type ImageJobStatus = "completed" | "queued" | "incompatible" | "error" | "rejected" | "disabled" | "unavailable";

export interface ImageJobResult {
  ok: boolean;
  status: ImageJobStatus;
  message: string;
  images: NormalizedImage[];
  jobId?: string;
}

export interface ImageHealth {
  provider: string;
  status: ImageProviderStatus;
  endpointConfigured: boolean;
  endpoint?: string; // sanitized origin+path only — never userinfo/query/key
  timeoutMs: number;
  outputBaseConfigured: boolean;
  reachable?: boolean;
  detail: string;
}

// Show only protocol+host+path; drop any userinfo, query string, or fragment that could carry a token.
function sanitizeEndpoint(raw: string): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return undefined;
  }
}

// Scrub anything secret-bearing from a free-text error before it reaches a result/log/UI:
// the configured endpoint (which may embed userinfo/token), the API key, plus generic
// userinfo and common secret query params in any URL the message might contain.
function scrubSecrets(s: string): string {
  let out = s;
  if (ENDPOINT) out = out.split(ENDPOINT).join("<endpoint>");
  if (API_KEY) out = out.split(API_KEY).join("<redacted>");
  out = out.replace(/(https?:\/\/)[^@\s/]*@/gi, "$1<redacted>@").replace(/([?&](?:token|key|api[_-]?key|password|secret)=)[^&\s]+/gi, "$1<redacted>");
  return out;
}

function withBase(url: string): string {
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  if (OUTPUT_BASE) return `${OUTPUT_BASE.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
  return url;
}

function coerceImage(item: unknown): NormalizedImage | null {
  if (item == null) return null;
  if (typeof item === "string") {
    const s = item.trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return { url: withBase(s) };
    if (s.startsWith("data:")) {
      const m = /^data:([^;,]+)?[^,]*,(.*)$/s.exec(s);
      return m ? { base64: m[2], mimeType: m[1] || undefined } : { base64: s };
    }
    if (/^[\/.\w-]+\.(png|jpe?g|webp|gif)$/i.test(s)) return { url: withBase(s) };
    return { base64: s };
  }
  if (typeof item === "object") {
    const o = item as Record<string, unknown>;
    const urlRaw = typeof o.url === "string" ? o.url : typeof o.image === "string" && /^https?:\/\//i.test(o.image) ? (o.image as string) : undefined;
    const b64 =
      typeof o.base64 === "string" ? o.base64 :
      typeof o.b64_json === "string" ? o.b64_json :
      typeof o.b64 === "string" ? o.b64 :
      typeof o.image === "string" && !/^https?:\/\//i.test(o.image) ? (o.image as string) : undefined;
    const img: NormalizedImage = {
      url: urlRaw ? withBase(urlRaw) : undefined,
      base64: b64,
      mimeType: typeof o.mimeType === "string" ? o.mimeType : typeof o.content_type === "string" ? (o.content_type as string) : undefined,
      seed: typeof o.seed === "number" ? o.seed : undefined,
      metadata: o.metadata && typeof o.metadata === "object" ? (o.metadata as Record<string, unknown>) : undefined,
    };
    return img.url || img.base64 ? img : null;
  }
  return null;
}

// ComfyUI image descriptor → a /view URL (relative; absolutized via PILOT_IMAGE_OUTPUT_BASE_URL).
// ComfyUI returns {filename, subfolder, type} and serves bytes at <base>/view?filename=...&subfolder=...&type=...
function comfyImage(item: unknown): NormalizedImage | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  if (typeof o.filename !== "string") return null;
  const p = new URLSearchParams();
  p.set("filename", o.filename);
  if (typeof o.subfolder === "string") p.set("subfolder", o.subfolder);
  if (typeof o.type === "string") p.set("type", o.type);
  return { url: withBase(`/view?${p.toString()}`), metadata: { filename: o.filename, subfolder: typeof o.subfolder === "string" ? o.subfolder : undefined, type: typeof o.type === "string" ? o.type : undefined } };
}

// Tolerate common SDXL / ComfyUI / A1111 / diffusers response shapes. NEVER fabricates an image.
export function normalizeImages(body: unknown): NormalizedImage[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  // ComfyUI history shape: { outputs: { <nodeId>: { images: [{filename,subfolder,type}, ...] } } }
  if (b.outputs && typeof b.outputs === "object" && !Array.isArray(b.outputs)) {
    const out: NormalizedImage[] = [];
    for (const node of Object.values(b.outputs as Record<string, unknown>)) {
      const imgs = node && typeof node === "object" ? (node as Record<string, unknown>).images : undefined;
      if (Array.isArray(imgs)) {
        for (const img of imgs) {
          const c = comfyImage(img) ?? coerceImage(img);
          if (c) out.push(c);
        }
      }
    }
    if (out.length) return out;
  }
  const container =
    Array.isArray(b.images) ? b.images :
    Array.isArray(b.output) ? b.output :
    Array.isArray(b.outputs) ? b.outputs :
    Array.isArray(b.artifacts) ? b.artifacts :
    Array.isArray(b.data) ? b.data :
    null;
  const items: unknown[] = container ?? (b.image != null ? [b.image] : b.url != null ? [b.url] : []);
  return items.map(coerceImage).filter((x): x is NormalizedImage => x != null);
}

function extractJobId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  for (const k of ["id", "job_id", "jobId", "task_id", "taskId", "request_id"]) {
    if (typeof b[k] === "string") return b[k] as string;
  }
  return undefined;
}

export async function imageHealth(): Promise<ImageHealth> {
  const status = imageProviderStatus();
  const base = {
    provider: imageProviderMode(),
    status,
    endpointConfigured: !!ENDPOINT,
    endpoint: sanitizeEndpoint(ENDPOINT),
    timeoutMs: TIMEOUT_MS,
    outputBaseConfigured: !!OUTPUT_BASE,
  };
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
  return { ...base, reachable, detail: reachable ? "endpoint reachable — POST an approved image.generate to verify response compatibility" : "endpoint configured but not reachable" };
}

// Submit a generation job. Returns a safe, normalized result; never throws on
// unavailable, never exposes keys, never fabricates an image.
export async function submitImageJob(a: Record<string, unknown>): Promise<ImageJobResult> {
  const status = imageProviderStatus();
  if (status !== "configured") {
    return { ok: false, status: status === "disabled" ? "disabled" : "unavailable", images: [], message: status === "disabled" ? "image provider is disabled" : "image provider endpoint not configured (PILOT_IMAGE_ENDPOINT unset)" };
  }
  let req: ImageRequest;
  try {
    req = normalizeImageRequest(a);
  } catch (e) {
    return { ok: false, status: "rejected", images: [], message: e instanceof Error ? e.message : "invalid request" };
  }
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (API_KEY) headers.authorization = `Bearer ${API_KEY}`;
  try {
    const res = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(req), signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!res.ok) {
      const detail = typeof body === "string" ? ` ${scrubSecrets(body.slice(0, 200))}` : "";
      return { ok: false, status: "error", images: [], message: `provider returned HTTP ${res.status}${detail}` };
    }
    const images = normalizeImages(body);
    if (images.length > 0) return { ok: true, status: "completed", images, message: `provider returned ${images.length} image(s)` };
    const jobId = extractJobId(body);
    if (jobId) return { ok: true, status: "queued", images: [], jobId, message: `provider queued job ${jobId}` };
    return { ok: false, status: "incompatible", images: [], message: "provider responded 200 but no recognizable image fields (images / image / output / url / artifacts)" };
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    const safe = scrubSecrets(e instanceof Error ? e.message : "unknown");
    return { ok: false, status: "error", images: [], message: timedOut ? `provider request timed out after ${TIMEOUT_MS}ms` : `provider request failed: ${safe}` };
  }
}
