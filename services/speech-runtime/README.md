# MigraPilot speech runtime

A **resident** faster-whisper service. The Brain owns the ASR capability and delegates here
via `MIGRAPILOT_SPEECH_RUNTIME_URL`; no product imports this, and this imports no product.

## Why it exists

The previous implementation spawned Python per request, so the model reloaded on every call —
measured at **~18.5 s** for a short clip. This loads once and stays resident: **0.56–0.77 s**
per request on an RTX 3090 (`large-v3`, float16, ~4.3 GB VRAM, 6.8 s cold start).

## Run

```bash
python3 services/speech-runtime/server.py
```

| env | default | notes |
|---|---|---|
| `SPEECH_MODEL` | `large-v3` | An `.en` model serves English only and says so. |
| `SPEECH_DEVICE` | `auto` | `auto` picks cuda when CTranslate2 sees a device. |
| `SPEECH_COMPUTE` | float16 (cuda) / int8 (cpu) | |
| `SPEECH_HOST` / `SPEECH_PORT` | `127.0.0.1` / `4600` | |
| `SPEECH_LANGUAGES` | `en,fr,es,ht` | Languages this deployment will CLAIM. |
| `SPEECH_CUDA_LIBS` | — | Colon-separated dirs holding `libcublas.so.12` and `libcudnn*.so.9`. |

### `SPEECH_CUDA_LIBS`, and why it exists

CTranslate2 `dlopen`s CUDA libraries **lazily**. A model constructs successfully on `cuda`
even when they are absent — the failure appears on the first transcription
(`Library libcublas.so.12 is not found`). A production deployment should install CUDA
properly and leave this unset. It exists for a box that already has the libraries inside a
venv:

```bash
V=/path/to/venv/lib/python3.12/site-packages/nvidia
SPEECH_CUDA_LIBS="$V/cublas/lib:$V/cudnn/lib" python3 services/speech-runtime/server.py
```

## Readiness is proven, not assumed

Startup runs a real warmup transcription. Only if it succeeds does `/capability` report
`ready: true`. This is not ceremony: the first version reported ready against a model that
could not transcribe at all, which is exactly the over-claim the transcription contract
exists to prevent. A CUDA failure degrades to CPU and **says so** via `device` rather than
serving nothing or pretending to be fast.

## API

- `GET /capability` → `{ ready, model, multilingual, supportedLanguages, device }`, or
  `{ ready: false, unavailableReason }`.
- `GET /health` → `{ ok }`
- `POST /transcribe` `{ audio: base64, requestedLanguage? }` →
  `{ text, language, languageProbability, model, englishOnly, requestedLanguage, forcedLanguage }`

### Three language fields, never collapsed

| field | meaning |
|---|---|
| `requestedLanguage` | what the CALLER explicitly asked for; absent unless they did |
| `forcedLanguage` | what the decoder was told to assume; `null` = free to detect |
| `language` | what the model DETECTED; `null` when it cannot detect at all |

Collapsing requested and forced once disabled the fabrication guard: French audio returned a
fluent invented English sentence marked safe to send. An English-only model is pinned to
`en` whether or not anyone asked — that pin is `forcedLanguage`, never a request, and never
reported as a detection.

## Not qualified for Haitian Creole

`ht` appears in `supportedLanguages` because the multilingual model supports it. That is an
**infrastructure fact, not a quality result**. See
`MigraAI-Engineer/evaluations/haitian-creole/NATURAL-CONVERSATION-GATE.md`.
