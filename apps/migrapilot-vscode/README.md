# MigraPilot — VS Code Extension (canonical)

**This is the active, canonical MigraPilot VS Code extension.** It supersedes the
retired `migrateck.migrapilot-vscode-extension` (0.4.x) and `apps/vscode-extension`
lines. All MigraPilot in-editor chat work happens here.

## Identity

| | |
|---|---|
| Extension ID | `migrateck.migrapilot-vscode` |
| Entry point | `./out/extension.js` |
| Activation | `onStartupFinished` |
| View container | `migrapilot` (activity bar) |
| Chat view ID | `migrapilot.chat` (webview) |
| Commands | `migrapilot.openChat`, `migrapilot.newChat`, `migrapilot.explainCurrentFile`, `migrapilot.reviewSelection`, `migrapilot.attachFile` |

## Backends

The chat talks to one of two backends, selected by `migrapilot.backend`:

- **`pilot-api` (default, canonical):** the full engine. Requests go to
  **`POST http://127.0.0.1:3377/api/pilot/chat/stream`** (Server-Sent Events:
  `conversation` / `provider` / `token` / `tool` / `usage` / `done`). Provides the
  canonical model router, durable Postgres state, tool loop, multi-turn history,
  and token accounting.
- **`pilot-web` (explicit compatibility fallback only):** the simpler Ollama-only
  engine at `POST http://127.0.0.1:3399/api/pilot/chat` (NDJSON). Used **only**
  when `migrapilot.backend` is explicitly set to `pilot-web`. There is **no silent
  fallback** — if pilot-api is unreachable the chat returns a clear error.

`apps/pilot-web` also serves the browser voice-recorder page.

## Model selection

- **`Auto (router picks)`** sends **no** literal model — pilot-api's canonical
  router chooses. (It does **not** map to a hardcoded model string.)
- Selecting a specific model sends that exact model unchanged.
- The **resolved** provider/model is shown in the transcript as a step
  (e.g. `Model: gpt-oss:120b-cloud (default)`), including any router fallback
  reason. Primary model is `gpt-oss:120b-cloud`.

## Capabilities

- Chat with streamed responses, code blocks, multi-turn history, cancellation.
- Active-file and selected-text context.
- Attachments: local file upload, workspace file pick, paste; **images are
  analyzed by a local vision model** (`llava:latest`, configurable via
  `migrapilot.visionModel`) and the analysis is injected into the message.
- Voice input via an external-browser recorder → local whisper transcription.

## Authentication & trust (localhost-only)

The extension talks to pilot-api over **localhost** (`127.0.0.1`). pilot-api runs
in dev mode (`PILOT_REQUIRE_AUTH=false`), so **no token is required for local
use**, and **no token is hardcoded or committed**. `migrapilot.apiToken` is
optional. **Remote/authenticated use is NOT implemented** — it would require VS
Code SecretStorage + TLS + real auth. Do not point this at a remote endpoint yet.

## Execution posture (dry-run only)

Chat runs pilot-api in **`dryRun` mode**: it can read, analyze, and plan, and it
surfaces the agent's tool activity — but **mutating tools do not execute live**.
The approve→resume (live execution) loop is **not implemented**. Likewise,
**proposed code edits (diff/apply)** and **remote auth** are **not implemented**;
do not assume any of these are complete.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `migrapilot.backend` | `pilot-api` | Backend mode (`pilot-api` \| `pilot-web`) |
| `migrapilot.pilotApiUrl` | `http://127.0.0.1:3377` | Canonical backend URL |
| `migrapilot.apiUrl` | `http://127.0.0.1:3399` | pilot-web fallback URL + voice page |
| `migrapilot.ollamaUrl` | `http://127.0.0.1:11434` | Ollama (model list + vision) |
| `migrapilot.visionModel` | `llava:latest` | Local vision model for image attachments |
| `migrapilot.apiToken` | `""` | Optional bearer token (unused on localhost) |

## Build

```
npm install
npm run compile   # tsc → out/
```

Run via the Extension Development Host (F5), then **Developer: Reload Window**
after rebuilds.
