# MigraPilot Image Generation Provider (SDXL adapter)

MigraPilot can submit image-generation jobs to a configured **SDXL-compatible HTTP
endpoint**. The adapter is **disabled by default**, env-gated, and every generation
is **approval-gated** through the Phase 9.6 policy layer. The adapter never installs
infrastructure, never runs a shell, and never exposes API keys.

Source: [`lib/pilot/image-provider.ts`](../lib/pilot/image-provider.ts).

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PILOT_IMAGE_PROVIDER` | `disabled` | `disabled` or `sdxl`. Anything other than `sdxl` is treated as disabled. |
| `PILOT_IMAGE_ENDPOINT` | _(unset)_ | Full URL of the SDXL HTTP endpoint that accepts a POST. Required for `sdxl` mode. |
| `PILOT_IMAGE_API_KEY` | _(unset)_ | Optional bearer token. Sent as `Authorization: Bearer <key>`. **Never logged, never returned, never shown in the UI or approval payload.** |
| `PILOT_IMAGE_TIMEOUT_MS` | `60000` | Request timeout in ms (also caps the health probe at 5s). |
| `PILOT_IMAGE_OUTPUT_BASE_URL` | _(unset)_ | Optional base URL used to absolutize relative image paths returned by the provider. |

A `.env.local` example (do not commit real keys):

```bash
PILOT_IMAGE_PROVIDER=sdxl
PILOT_IMAGE_ENDPOINT=https://sdxl.internal.example/generate
PILOT_IMAGE_API_KEY=...        # optional
PILOT_IMAGE_TIMEOUT_MS=120000  # optional
PILOT_IMAGE_OUTPUT_BASE_URL=https://cdn.example/img  # optional
```

## Request contract (what the adapter sends)

- **Method:** `POST`
- **Headers:** `content-type: application/json`, `accept: application/json`, and
  `authorization: Bearer <PILOT_IMAGE_API_KEY>` when a key is set.
- **Timeout:** `PILOT_IMAGE_TIMEOUT_MS` (default 60s), enforced via `AbortSignal.timeout`.
- **Body** (validated + normalized before sending — see guardrails):

```json
{
  "prompt": "a teal gradient logo",
  "negativePrompt": "blurry, watermark",
  "width": 1024,
  "height": 1024,
  "steps": 30,
  "seed": 12345,
  "stylePreset": "photographic",
  "count": 1,
  "metadata": { "any": "passthrough" }
}
```

### Request guardrails (enforced in `normalizeImageRequest`)

- Empty prompt is **rejected**.
- Prompt is capped at **2000 chars**.
- `width` / `height` are clamped to **64–2048** (default 1024).
- `steps` clamped to **1–100**; `count` clamped to **1–4** (default 1).
- Argument **keys** matching `secret|token|password|api_key|credential` are **rejected**.
- Raw filesystem **output paths** (`out`, `outputPath`, `path`, `file`, `dir`,
  `destination` whose value contains a path separator, drive letter, or `..`) are **rejected**.

## Response contract (what the adapter accepts)

On HTTP `2xx` the adapter tolerates the common SDXL / diffusers response shapes and
normalizes them into a stable internal shape. It **never fabricates** an image — if it
cannot find a recognizable image field it reports `incompatible`.

Accepted container shapes (first match wins): the **ComfyUI** `outputs` object (see below),
then `images[]`, `output[]`, `outputs[]` (array), `artifacts[]`, `data[]`, or a single `image` / `url`.

Each item may be:

- a **URL string** — `"https://.../img.png"`
- a **data URL** — `"data:image/png;base64,...."`
- a **bare filename / path** — `"out-001.png"` (absolutized with `PILOT_IMAGE_OUTPUT_BASE_URL` if set)
- a **base64 string**
- an **object** with any of: `url`, `image`, `base64` / `b64_json` / `b64`,
  `mimeType` / `content_type`, `seed`, `metadata`
- a **ComfyUI image descriptor** `{ filename, subfolder, type }` → normalized to a
  `/view?filename=…&subfolder=…&type=…` URL, absolutized with `PILOT_IMAGE_OUTPUT_BASE_URL`
  (set it to the ComfyUI base, e.g. `http://comfyui-host:8188`).

**ComfyUI** (`GET /history/{prompt_id}`) returns a nested `outputs` object keyed by node id; the
adapter walks every node's `images[]`. **A1111** (`/sdapi/v1/txt2img`) returns `{ images: [base64…] }`
— handled as base64 items.

Examples that all normalize successfully:

```json
{ "images": ["https://cdn.example/a.png", "https://cdn.example/b.png"] }
{ "image": "data:image/png;base64,iVBORw0..." }
{ "output": [{ "url": "/img/x.png", "seed": 42 }] }
{ "artifacts": [{ "base64": "iVBORw0...", "content_type": "image/png" }] }
{ "url": "https://cdn.example/single.png" }
{ "outputs": { "9": { "images": [{ "filename": "ComfyUI_00001_.png", "subfolder": "", "type": "output" }] } } }
```

### Normalized internal image shape

```ts
interface NormalizedImage {
  url?: string;        // absolutized via PILOT_IMAGE_OUTPUT_BASE_URL when relative
  base64?: string;
  mimeType?: string;
  seed?: number;
  metadata?: Record<string, unknown>;
}
```

### Job result statuses (`submitImageJob` → `ImageJobResult`)

| status | ok | meaning |
|---|---|---|
| `completed` | true | one or more images normalized from the response |
| `queued` | true | async provider returned a job id (`id`/`job_id`/`task_id`/…) but no image yet |
| `incompatible` | false | HTTP 200 but no recognizable image fields |
| `error` | false | non-2xx, network failure, or timeout |
| `rejected` | false | request failed a guardrail (e.g. empty prompt, secret-like key) |
| `disabled` / `unavailable` | false | provider off, or `sdxl` selected without an endpoint |

## Health / diagnostics

`GET /api/pilot/image/health` (and the `image.health` tool) returns, with **no secrets**:

```json
{
  "provider": "sdxl",
  "status": "configured",
  "endpointConfigured": true,
  "endpoint": "https://sdxl.internal.example/generate",
  "timeoutMs": 120000,
  "outputBaseConfigured": true,
  "reachable": true,
  "detail": "endpoint reachable — POST an approved image.generate to verify response compatibility"
}
```

`status` is one of `disabled` | `unavailable` (endpoint missing) | `configured`.
When configured, `reachable` is determined by a GET probe (any non-5xx = reachable).
`endpoint` is sanitized to **protocol + host + path only** — userinfo, query string,
and fragment are stripped so a token embedded in the URL is never echoed. Response
**compatibility** is only known after an actual `image.generate` POST.

## How to test against a real endpoint

1. Set the env vars in `.env.local` (above) and restart `npm run dev`.
2. Open the command center → **Governance → Image**. Confirm `Status: configured`
   and `Reachable: yes`.
3. In chat, ask: *"Preview an image request: a red car, 1024x768"* → runs `image.preview`
   (read-only, no submit) and shows the normalized request.
4. In chat, ask the agent to **generate** an image. `image.generate` is
   `requires_approval`, so an **approval card** appears. Approve it to submit exactly
   the approved request; the result reports the number of normalized images (URLs or
   base64 length — never raw base64 content, never the API key).

## Safety summary

- Generation is **always approval-gated** (`image.generate` = `requires_approval`).
- The adapter adds **no** infrastructure, shell, deploy, DB, or package tooling.
- API keys are sent only in the `Authorization` header and are **never** logged,
  returned, rendered, or placed in an approval payload.
- Default mode is **disabled** and degrades safely (no crash) when the endpoint is
  missing or unreachable.
