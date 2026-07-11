# MigraPilot VS Code — Manual Extension Development Host Smoke

> OPERATOR-TO-RUN. These steps require the real VS Code GUI and cannot be driven
> by CI or an automated agent. The automated suites (`npm run test:all`) prove
> the client/context/attachment/streaming/cancellation logic headlessly; this
> checklist proves the rendered GUI wiring. Do NOT claim GUI validation unless
> you personally performed these steps.

## Preconditions
- pilot-api running locally: `GET http://127.0.0.1:3377/health` → `{"ok":true}`.
- Ollama running for model listing / vision: `http://127.0.0.1:11434`.
- Extension built: `npm ci && npm run compile` in `apps/migrapilot-vscode`.

## Launch
1. Open `apps/migrapilot-vscode` in VS Code, press **F5** (Run Extension) to open an Extension Development Host.
2. In the dev host, run **Developer: Reload Window** once.

## Checklist
| # | Step | Expected |
|---|------|----------|
| 1 | Open the MigraPilot view (activity bar icon) | Chat panel renders, no error toast |
| 2 | Confirm settings: `migrapilot.backend` | Defaults to **pilot-api** (no manual change needed) |
| 3 | Send a normal coding question (e.g. "explain async/await") | Tokens stream in; a `Model: …` step appears |
| 4 | Watch pilot-api logs / `.pilot-api-dev.log` | A `POST /api/pilot/chat/stream` with `dryRun:true` arrives |
| 5 | Verify resolved model shown | Transcript shows the provider/model step |
| 6 | Attach an image (Attach File → .png) and ask about it | "Analyzing image(s)…" step, then a visual-analysis answer |
| 7 | Attach a code file (Attach File → .ts) | Chip appears; answer references the file content |
| 8 | Select code in an editor, then "Review Selection" | Selected code is used as context (not whole file) |
| 9 | Send a long prompt, then run **MigraPilot: Cancel Response** (or start a New Chat mid-stream) | Response stops with "⏹️ Response cancelled."; no false completion appended |
| 10 | Run **MigraPilot: New Chat** | Transcript + chips cleared; prior history not carried into next turn |
| 11 | Request a mutating task ("delete the pod X") | Stays dry-run; any tool needing approval shows "⚠️ Approval required…" (never executes live) |
| 12 | Command Palette → type "MigraPilot" | Exactly one of each command; no duplicate `openChat`/`newChat`/… entries; one MigraPilot view |
| 13 | Attempt a file attachment >5 MB or a `.exe` | Rejected with a warning toast (no attachment chip) |
| 14 | Open a `.env` file, then ask a question | Its contents are NOT included in context (withheld); path may still be named |
| 15 | Set `migrapilot.backend = pilot-web`, send a message | Only then does traffic go to `:3399` (`/api/pilot/chat`); switch back to pilot-api after |

## Pass criteria
- No duplicate commands/views (row 12).
- No `pilot-web` request while backend = pilot-api (rows 3-4, 15).
- Mutating requests remain dry-run (row 11).
- Cancel produces no false completion (row 9).
