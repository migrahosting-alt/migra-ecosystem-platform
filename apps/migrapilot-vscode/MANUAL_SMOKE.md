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

---

# Phase C — Proposed-Edit Review / Apply / Rollback (OPERATOR-TO-RUN)

> The proposal contract, path/secret/stale/dirty/symlink safety, the real
> WorkspaceEdit apply path, partial-failure reporting, and rollback are all proven
> headlessly by `test/edits/*` (36 tests) against the in-memory vscode mock, and by
> pilot-api `test/behavior/proposedEdits.behavior.test.ts` (29 tests). These GUI
> steps prove the rendered diff/approve/apply/rollback wiring. Do NOT claim GUI
> completion unless you personally performed them.

## Preconditions
- pilot-api running: `GET http://127.0.0.1:3377/health` → `{"ok":true}` (migration `add_proposed_edits` applied).
- A trusted, single-root workspace open in the Extension Development Host.

## Checklist
| # | Step | Expected |
|---|------|----------|
| C1 | Ask MigraPilot to modify one test file; it emits a `proposed_edit` tool result | A proposal appears (status *received*); no file changes yet |
| C2 | Run **MigraPilot: Review Proposed Edit** (or click the file) | Native side-by-side diff opens; "after" side is exactly the proposed content |
| C3 | **Reject Proposed Edit** | Status *rejected*; Apply is unavailable |
| C4 | Ask again → **Approve Proposed Edit** | Status *approved*; Apply becomes available |
| C5 | **Apply Proposed Edit** | File content changes to the proposed content; info toast "applied … Rollback is available" |
| C6 | Inspect `git status` in a terminal | The file is modified in the working tree; **no** stage/commit/push occurred |
| C7 | **Roll Back Proposed Edit** | Original content restored; status *rolled_back* |
| C8 | Edit the applied file by hand, then re-apply a fresh approved proposal and **Roll Back** | Rollback is **blocked** ("changed_since_apply"); your hand edits are preserved |
| C9 | Leave a target file dirty (unsaved) and try **Apply** | Blocked with a "dirty" reason; nothing written |
| C10 | Externally change a target file after approval, then **Apply** | Blocked with a "stale" reason; nothing written |
| C11 | Multi-file proposal (create+modify+delete+rename) → review each → approve → apply | All four apply; each shows correct operation badge; delete/rename show destructive warning |
| C12 | Try to review/apply a `.env` (or `*.pem`) proposal | Proposed content is withheld; apply blocked (secret-file protection) |

## Pass criteria
- No plain chat reply ever mutates a file (only an explicit approved proposal can).
- Apply requires approval AND passes the fail-closed preflight (trust, containment, symlink, dirty, hash).
- Rollback never overwrites newer user work.
- No git stage/commit/push happens on any apply/rollback path.

---

# Phase C.5 — Proposal Generation from Chat + Proposal Cards (OPERATOR-TO-RUN)

> The generation contract (model `propose_edit` tool → strict validated proposal),
> the `proposal` SSE event, the card metadata (files/lines/risk), and the
> chat→card→approve→apply→rollback wiring are proven headlessly by pilot-api
> `test/behavior/proposalGeneration.behavior.test.ts` (13) + `proposeEditTool.test.ts`
> (8) and by extension `test/client/proposalStream.test.ts` (5),
> `test/edits/proposalCardWiring.test.ts` (5), and `test/smoke/proposalEndToEnd.test.ts`
> (2, full flow with the REAL WorkspaceEdit). These GUI steps prove the rendered card
> + native diff + button wiring. Do NOT claim GUI completion unless you personally
> performed them.

## Preconditions
- pilot-api running: `GET http://127.0.0.1:3377/health` → `{"ok":true}` (migration `add_proposed_edits` applied).
- Backend = `pilot-api` (`migrapilot.backend`); a trusted, single-root workspace open in the Extension Development Host.
- Ollama reachable (primary model `gpt-oss:120b-cloud`) so the model can call `propose_edit`.

## Checklist
| # | Step | Expected |
|---|------|----------|
| D1 | In chat: "Refactor `<an existing test file>` to split its largest function into helpers." | A **proposal card** appears in the transcript: 📝 title, 🤖 model, 📁 files affected, ➕/➖ lines, ⚠ risk, 📋 summary, ⏱ expires-in, and buttons Review Diff / Approve / Reject / Apply / Rollback. **No file changes yet.** |
| D2 | Confirm the assistant reply does **not** paste the changed code | The code lives only in the proposal; the reply is a brief confirmation |
| D3 | Click **🔍 Review Diff** | Native side-by-side diff opens; the "after" side is exactly the proposed content |
| D4 | Note that **Apply** is disabled | Apply is greyed until the proposal is approved |
| D5 | Click **✅ Approve** | Card status → *approved*; **Apply** becomes enabled |
| D6 | Click **⚙ Apply** | File content changes to the proposed content; card status → *rollback available*; info toast shown |
| D7 | Inspect `git status` in a terminal | File modified in the working tree; **no** stage/commit/push occurred (no git action on any path) |
| D8 | Click **↩ Rollback** | Original content restored; card status → *rolled back* |
| D9 | New chat: "Delete `<file>` and rename `<file2>` to `<file3>`." | Card shows 🗑 **Destructive** flag; risk **High** |
| D10 | New chat: "Update the value in `.env`." | Card shows 🔒 **protected/secret** flag; Review Diff warns content is withheld; Apply is blocked (secret protection) |
| D11 | New chat asking a multi-file change (create+modify) → Approve → Apply | Card `files affected` = N; all files apply; diff shows the correct operation per file |
| D12 | Ask for a change, then **❌ Reject** before approving | Card status → *rejected*; Apply never becomes available; file untouched |
| D13 | Approve, hand-edit the target file (dirty/unsaved), then **Apply** | Apply **blocked** with a dirty/stale reason in the card status; nothing written |
| D14 | Start a change request, then click **Stop/Cancel** mid-stream | No proposal card is left behind for the cancelled turn (no orphan applicable proposal) |

## Pass criteria
- Only the validated `propose_edit` tool path can create a proposal — plain chat text never mints an applicable proposal.
- The card renders every required field and reflects the Phase C state machine (received → reviewing → approved/rejected → applying → applied → rollback available → rolled back / blocked / stale).
- Apply requires approval AND passes the fail-closed preflight; Rollback never overwrites newer user work.
- No git stage/commit/push happens on any apply/rollback path.
- Destructive (delete/rename) and secret-affecting proposals are clearly flagged.
