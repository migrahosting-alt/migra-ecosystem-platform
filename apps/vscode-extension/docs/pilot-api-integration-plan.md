# pilot-api Integration — Design Plan

**Status:** Draft for review · **No implementation edits yet**
**Milestone this builds on:** `MIGRAPILOT_VSCODE_EXTENSION_E2E_AND_VSIX_READY`
**Scope:** Wire the canonical extension (`apps/vscode-extension`, pkg `migrapilot-extension`) to the full-strength `pilot-api` engine while preserving the local brain-service path and its deterministic test stub.

---

## 0. Context & grounding (verified against source)

Three components exist today:

| Component | Location | Transport | Auth | Health shape |
|---|---|---|---|---|
| **Extension** | `apps/vscode-extension` (this repo, tracked) | `fetch` JSON to a configured base URL | none | — |
| **brain-service** | `apps/brain-service` (gitignored) | Fastify JSON, default **:3988** | none | `{status,service:"migrapilot-brain",version,uptimeSec,providers,indexes}` |
| **pilot-api** | `services/pilot-api` (on-host source-of-truth, gitignored in dev), Express + Prisma, phase-36, default **:3377** | JSON + **SSE** | **Bearer JWT** | `{ok,service:"pilot-api"}` / `/health/ready` DB-gated / `/api/pilot/v1/health` detailed |

**Verified pilot-api surface** (`services/pilot-api/services/pilot-api/src`):

- Health: `GET /health`, `GET /health/live`, `GET /health/ready` (DB), `GET /health/worker/{live,ready}`, `GET /api/pilot/v1/health` (api+db+stats).
- Stable v1: `GET /api/pilot/v1/commands`, `POST /api/pilot/v1/plan`, `POST /api/pilot/v1/execute`, `GET /api/pilot/v1/runs`, `GET /api/pilot/v1/runs/:id`, graph/audit/edges.
- Chat: `POST /api/pilot/chat/stream` — **SSE** (`text/event-stream`), events `plan` → `tool-start` → tool status → `completed`; cancels server-side work on `res` close.
- Tools/edits: `POST /api/pilot/proposed-edits`, `/api/pilot/repo`, `/api/pilot/workspace`, `/api/pilot/knowledge`, `/api/pilot/memory`.
- Approvals: `/api/pilot/pending-actions` (`GET /`, `GET /:id`, `POST /:id/approve`, `POST /:id/reject`, `POST /:id/resume`), `/api/pilot/execution-approvals`, `/api/approvals`.
- Replay: `/api/pilot/replay/{runs, :runId, :runId/tools, diff}`.
- Correlation/ops: `/api/ops/correlation`, `/api/ops/predictive`, `/api/ops/trust`.
- **Auth** (`middleware/auth.ts`, `authOptional.ts`): `Authorization: Bearer <JWT>`, verified with `AUTH_JWT_SECRET`/`JWT_SECRET`; actor `{userId, role, tenantId, token}`. `requireAuthOrDev` = JWT when `PILOT_REQUIRE_AUTH` truthy or a Bearer is present; **dev-operator bypass is hard-blocked in prod** (`APP_ENV=prod`/`NODE_ENV=production` → 401).

**Prior art:** `apps/migrapilot-vscode` already streams from pilot-api (config `migrapilot.backend` = `pilot-web|pilot-api`, `migrapilot.pilotApiUrl` default `http://127.0.0.1:3377`, `migrapilot.apiToken` → `Bearer`). `apps/migrapilot-console` centralizes `PILOT_API_BASE` (`PILOT_API_URL`, default 3377) + `OPS_API_TOKEN`.

### 0.1 Canonical-extension decision (RESOLVED — P0, 2026-07-15)

**Owner decision:** `apps/vscode-extension` (`migrateck.migrapilot-extension`) is the **canonical** shipping surface. `apps/migrapilot-vscode` is **prior-art/reference** (its `src/pilotClient.ts` pilot-api SSE transport is the P1 reference); `apps/migrapilot-vscode-extension` is **retired**. Full classification, the ambiguity inventory, and reclassification actions are in [`canonical-extension-status.md`](./canonical-extension-status.md). Capability contract locked in [`pilot-api-capabilities.v1.md`](./pilot-api-capabilities.v1.md).

---

## 1. Transport & endpoint boundaries

Adopt a **three-tier, mode-routed** architecture. The extension never guesses a backend per-call; a single `BackendRouter` resolves the active backend from the operating mode and cached capability negotiation, then every feature calls through it.

```
                         ┌─────────────────────── local-brain mode ──────────────┐
 VS Code feature ──▶ BackendRouter ──▶ BrainClient ──▶ brain-service :3988 (JSON) │
 (chat/explain/fix/…)     │           └───────────────────────────────────────────┘
                          │           ┌─────────────────────── remote-pilot mode ─┐
                          └──────────▶ PilotApiClient ──▶ pilot-api :3377 (JSON+SSE, JWT)
                                                          └──────────────────────────┘
```

**Boundary rules**

- **Extension owns:** editor/selection/diagnostics capture, workspace paths, user consent/approval UI, artifact rendering (docs, diffs), and correlation-ID minting. It holds **no** model logic.
- **brain-service owns (local mode):** the *existing* contract only — `/route`, `/retrieve`, `/chat`, `/tools/*`, `/internal/diagnostics.sync`. Deterministic stub provider stays the default for tests. brain-service is **not** a proxy to pilot-api in v1 (keeps the local path hermetic; a future “hybrid escalation” is an explicit non-goal below).
- **pilot-api owns (remote mode):** planning/execution, real model providers, tool execution, approvals, replay, correlation, persistence. The extension consumes its **existing** endpoints; any new pilot-api endpoint (see §3) is proposed, not assumed, and must be built **on-host** (pilot-api is source-of-truth on-host and gitignored here — never push local→prod).
- **One base URL per backend**, trailing-slash-normalized, from config. No hardcoded ports in feature code.

**Contract mapping (extension feature → backend endpoint)**

| Feature | local-brain | remote-pilot |
|---|---|---|
| chat participant | `POST /chat` (buffered) | `POST /api/pilot/chat/stream` (SSE) |
| explain / fix context | `/route`+`/retrieve`+`/tools/*` | `/api/pilot/workspace` + `/api/pilot/repo` + `/api/pilot/knowledge` |
| proposed edits preview/apply | `/tools/edit.preview` + `/tools/edit.apply` | `/api/pilot/proposed-edits` |
| diagnostics sync | `/internal/diagnostics.sync` | `/api/pilot/workspace` (diagnostics ingest) |
| approvals | n/a (stub auto-approves) | `/api/pilot/pending-actions/*` |
| health/capability | `GET /health` | `GET /health/ready` + `GET /api/pilot/v1/capabilities` (proposed) |

---

## 2. Authentication & configuration ownership

**Auth model:** `Authorization: Bearer <JWT>` for all pilot-api calls. The JWT is issued by the ecosystem identity plane (auth-api / identity-service per ecosystem topology), **not minted by the extension**. The extension is a bearer-token *carrier*, never an issuer.

**Config ownership (new `migrapilot.*` settings; extension `package.json`):**

| Setting | Default | Owner | Notes |
|---|---|---|---|
| `migrapilot.mode` | `hybrid` | user | remap to `local-brain`\|`remote-pilot`\|`auto` (see §8); keep back-compat with existing `offline/cloud/hybrid` values |
| `migrapilot.brainUrl` | `http://127.0.0.1:3988` | user | existing |
| `migrapilot.pilotApiUrl` | `http://127.0.0.1:3377` | user | matches console/prior-art convention |
| `migrapilot.pilotApiToken` | `""` | user | **stored via VS Code SecretStorage, not settings.json** — the setting is a fallback/dev affordance only; see below |
| `migrapilot.requestTimeoutMs` | `30000` | user | per-request ceiling |
| `migrapilot.pilotApiAuthMode` | `bearer` | user | `bearer` \| `none` (local dev pilot-api with `PILOT_REQUIRE_AUTH` off) |

**Secret handling (per repo security rules):** the pilot-api token is a credential. Primary store = **`vscode.ExtensionContext.secrets`** (SecretStorage). A `migrapilot.setToken` command prompts once and writes to SecretStorage; the plaintext is never logged, echoed, or persisted to `settings.json`. `migrapilot.pilotApiToken` (settings) is read **only** if SecretStorage is empty, to support headless/dev. The extension never reads the token back to the user.

**Prod safety:** if `pilotApiAuthMode=bearer` and no token resolves, remote-pilot mode enters **degraded/unauthenticated** state (see §9) — it does **not** silently fall back to the local stub in production intent (see §12 hard rule).

---

## 3. Health & capability negotiation

**Two-step handshake on activation and on backend switch:**

1. **Liveness/readiness** — remote: `GET /health/ready` (200 = api+db ready; 503 = degraded). local: `GET /health` (`service==="migrapilot-brain"`).
2. **Capabilities** — remote: `GET /api/pilot/v1/capabilities` *(proposed new endpoint; see below)*. Response (proposed):

```jsonc
{
  "service": "pilot-api",
  "version": "36.x",
  "authMode": "bearer",          // or "dev-open"
  "streaming": true,             // SSE chat
  "features": {
    "proposedEdits": true,
    "approvals": true,
    "replay": true,
    "correlation": true
  },
  "tools": ["repo.read", "workspace.search", "..."],
  "minExtensionVersion": "0.1.0"
}
```

**Degrade-gracefully rule:** if `/api/pilot/v1/capabilities` is **absent** (older pilot-api), negotiation falls back to a conservative capability set inferred from `/api/pilot/v1/health` + a feature probe (HTTP `OPTIONS`/`404` checks), logs the downgrade to the output channel (no silent capability assumption), and disables features the server can’t prove. Capabilities are cached per (baseUrl, token-hash) with a short TTL and re-negotiated on 401/timeout.

**pilot-api change required (on-host):** add `GET /api/pilot/v1/capabilities`. This is the *only* strictly-required server addition; everything else consumes existing endpoints. It must be implemented on-host and is out of scope for edits in this repo (§12 non-goals).

---

## 4. Request IDs, action IDs & correlation

- **`requestId`** — minted extension-side per user-initiated operation (UUID; `Math.random`/`Date.now` are unavailable in some sandboxes but fine in the extension host). Sent as `X-Request-Id` on every call (both backends). Logged in the output channel with the operation label.
- **`actionId`** — server-issued identifier for a discrete approvable/executable action (from `pending-actions`/`execute` responses). The extension treats it as opaque and echoes it on approve/reject/resume/replay.
- **`runId`** — server-issued execution run id (from `/execute` and chat `plan`/`completed` events). Used for `/runs/:id` polling and `/replay/*`.
- **Propagation:** `X-Request-Id` in → same id echoed in responses/SSE frames where pilot-api supports it (`/api/ops/correlation`); the extension correlates SSE frames to the originating `requestId` locally by stream handle when the server doesn’t echo.
- **Idempotency:** approve/reject/resume/execute carry `X-Request-Id` as an idempotency key so retries (network reconnect) don’t double-execute (server-side idempotency is assumed for `pending-actions`; verify on-host, else the extension guards with a client-side “in-flight actionId” set).

---

## 5. Timeout, cancellation, retry, reconnect

- **Timeout:** every request wraps an `AbortController` with `migrapilot.requestTimeoutMs`. SSE streams use an **idle** timeout (no frame within N s) rather than a total-duration timeout.
- **Cancellation:** VS Code `CancellationToken` (chat requests, long commands) is bridged to the `AbortController`. Aborting a chat SSE closes the response → pilot-api cancels server work (`res.on("close")` already does this).
- **Retry:** only **idempotent, safe** GETs (health, capabilities, `runs`) and explicitly-idempotent POSTs (guarded by `X-Request-Id`) retry, with capped exponential backoff (e.g. 3 tries, 250 ms → 1 s → 2 s, jittered). **Never** blind-retry `execute`/`approve` without the idempotency key.
- **Reconnect (SSE):** on mid-stream disconnect, if a `runId` was received, resume by polling `GET /api/pilot/v1/runs/:id` (and `/replay/:runId/tools`) to reconcile terminal state instead of replaying tokens. If no `runId` yet, surface a retryable error. Bounded reconnect attempts; then degrade.

---

## 6. Structured error taxonomy & user-facing mapping

Normalize all backend failures into one internal `PilotError { code, httpStatus, retriable, cause, requestId }`.

| Internal code | Source signal | User-facing message | Action offered |
|---|---|---|---|
| `AUTH_REQUIRED` | 401 `AUTH_REQUIRED` | “MigraPilot needs to sign in to the Pilot service.” | `Set Token` cmd |
| `AUTH_INVALID` | 401 `INVALID_TOKEN` | “Your Pilot token is invalid or expired.” | `Set Token` |
| `NOT_READY` | 503 `/health/ready` | “Pilot service is starting or its database is unavailable.” | `Retry`, `Show Logs` |
| `TIMEOUT` | AbortController | “The Pilot service didn’t respond in time.” | `Retry`, switch to local |
| `RATE_LIMITED` | 429 | “Pilot is rate-limiting requests; retrying shortly.” | auto-backoff |
| `CAPABILITY_MISSING` | negotiation | “This action isn’t supported by the connected Pilot version.” | disable feature |
| `NETWORK` | fetch throw | “Couldn’t reach Pilot at `<url>`.” | `Repair Connection` |
| `SERVER_ERROR` | 5xx | “Pilot hit an internal error.” | `Show Logs` (+ requestId) |
| `CANCELLED` | user abort | silent | — |

Every surfaced error includes the `requestId` in the output channel (not the toast) for support correlation. No stack traces to users (mirrors pilot-api’s own error handler).

---

## 7. Approval events: delivery, resume, reject, replay

**Model:** pilot-api gates mutating actions behind `pending-actions`. The extension is the **approver UI**.

- **Discovery/delivery:** during a chat/execute SSE stream, an approval-needed event surfaces an `actionId`. Out-of-band, the extension polls `GET /api/pilot/pending-actions` (bounded interval, only while a run is active or the Pilot view is focused) to catch actions raised without an open stream.
- **Present:** each pending action → a VS Code modal/QuickPick showing the action summary + diff (via `/replay/:runId/tools` or the action payload). **No auto-approval in remote mode.**
- **Approve:** `POST /api/pilot/pending-actions/:id/approve` (with `X-Request-Id` idempotency). On success, if the action pauses a run, `POST /:id/resume` continues it; the extension re-attaches to the run stream or polls `/runs/:id`.
- **Reject:** `POST /:id/reject` with optional reason; the run terminates or re-plans server-side; the extension reflects terminal state.
- **Replay:** `GET /api/pilot/replay/:runId`, `/:runId/tools`, `/diff` render an after-the-fact audit view (read-only) — used both for approval context and post-run inspection.
- **Resume after disconnect:** approvals are server-persisted; on reconnect the extension re-lists `pending-actions` and reconciles — an approval decided offline is not lost, and a replayed stream never re-prompts an already-decided `actionId` (dedupe by `actionId`, mirroring the E2E “dedupe vs seen” discipline).

---

## 8. Local-brain vs remote-pilot operating modes

Collapse the existing `migrapilot.mode` (`hybrid|offline|cloud`) onto explicit backends (keep old values as aliases for back-compat):

| Mode (new) | Alias | Backend | Behavior |
|---|---|---|---|
| `local-brain` | `offline` | brain-service | Fully local; deterministic stub or local provider. No pilot-api calls. |
| `remote-pilot` | `cloud` | pilot-api | Full engine; requires readiness + (usually) auth. No local stub. |
| `auto` | `hybrid` | negotiated | Prefer pilot-api when **ready + authorized**; otherwise use brain-service — but this preference is resolved **once at activation / on explicit “Repair Connection”, surfaced in the status bar**, and is **never a silent per-call fallback** while in an operation (see §12). |

**Status bar** shows the *resolved* backend and health (`$(sparkle) MigraPilot: pilot-api` / `$(server) MigraPilot: local` / `$(warning) …offline`). Switching modes re-runs negotiation (§3).

---

## 9. Startup, readiness, shutdown, degraded state

- **Startup:** on `activate`, resolve mode → negotiate (§3) → set status bar. Do not block activation on network; negotiation is async with a spinner state.
- **Readiness gate:** features that require a backend check the cached capability/health; if not ready, they show the degraded message + the relevant repair action rather than throwing.
- **brain-service auto-start (local mode only):** the existing `autoStartBrain`/`repairConnection` stubs get implemented **only** for `local-brain`/`auto`-choosing-local: bounded readiness wait (retry N×, backoff), owned-process tracking (PID), graceful `SIGTERM` on `deactivate`, and conflict handling — if the port is occupied by a **non-brain** service, do not adopt it (mirrors the brain reuse-guard fix). pilot-api is **never** auto-started by the extension (it’s a managed on-host/remote service).
- **Shutdown:** `deactivate` aborts in-flight requests, closes SSE streams, and kills only extension-owned child processes.
- **Degraded state:** a first-class status (not an error) — remote unreachable/unauthorized/capability-missing. UI stays responsive; disabled features explain why; `Repair Connection` re-negotiates.

---

## 10. Test strategy (dev Extension Host + packaged VSIX)

Reuse the existing harness (`test:integration`, `test:vsix`) and the two lessons already encoded (env-strip for WSL; per-extension `vscode` API objects → `IS_VSIX` non-blocking smokes).

- **Deterministic mock pilot-api** (`src/test/support/mockPilotApi.ts`, new) — an in-process HTTP+SSE server mirroring the real pilot-api contract with **fixed** responses (health, capabilities, chat SSE `plan→tool-start→completed`, a pending-action approve/reject/resume cycle, replay). This is the pilot-api analogue of the brain stub, and is the **only** pilot-api the tests ever touch (no live pilot-api, no DB).
- **Preserve the brain stub** unchanged for local-mode tests.
- **New suites:**
  - `pilotApiClient.test.ts` — auth header, `X-Request-Id`, timeout/abort, retry policy, error taxonomy mapping (unit-ish, against the mock).
  - `backendRouter.test.ts` — mode resolution, capability-gated feature enable/disable, no-silent-fallback assertion.
  - `approvals.test.ts` — pending-action present→approve→resume and reject flows; dedupe on replay.
  - Extend `extension.test.ts` — run the chat/explain/fix commands in **remote-pilot** mode against the mock; assert SSE-streamed artifacts. Runs in both dev-host and VSIX gates (dialog-blocking commands stay `IS_VSIX`-guarded).
- **Both gates green** required: `npm run test:integration` (dev, full) and `npm run test:vsix` (packaged).
- **No-silent-fallback test:** with mock pilot-api forced to 401/unreachable and mode=`remote-pilot`, assert the operation surfaces a `PilotError` (does **not** produce brain-stub output).

---

## 11. Migration path from stub `/chat`

Incremental, always-green:

1. **Add transport without switching default.** Ship `PilotApiClient` + `BackendRouter` with default mode `local-brain` (today’s behavior). New settings default to the local path. No user-visible change.
2. **Opt-in remote.** Users set `mode=remote-pilot` + token; chat routes to `/api/pilot/chat/stream`. brain stub remains default and the test backbone.
3. **Feature parity per command.** Migrate explain/fix/edits/diagnostics to the router one at a time, each behind capability negotiation, each with a mock-backed test, before flipping its remote path on.
4. **Approvals online.** Land §7 once chat+execute stream reliably.
5. **Default flip (owner decision).** Only after parity + acceptance criteria (§13) hold, consider defaulting `auto`. The deterministic stub stays as the test/local backend permanently.

At no point does the stub disappear, and remote failures never silently render stub output.

---

## 12. Non-goals & hard rules

**Non-goals (this milestone):**
- brain-service becoming a proxy/adapter in front of pilot-api (“hybrid escalation”) — explicitly deferred.
- Editing pilot-api in this repo. pilot-api is on-host source-of-truth and gitignored; the one required addition (`/api/pilot/v1/capabilities`) is a coordinated **on-host** change, tracked separately.
- Resolving the two-extensions question by deleting `apps/migrapilot-vscode` — that’s an owner decision (§0.1).
- New model-provider work inside brain-service beyond what tests need (separate track).
- Multi-tenant/role UI beyond carrying `tenantId`/`role` from the JWT.

**Hard rules:**
- **No silent fallback from pilot-api to stubbed behavior in production intent.** A remote failure is a surfaced, correlated error — never masked as a stub answer.
- **Deterministic brain stub is preserved** as the default test backend.
- **Secrets** (JWT) live in SecretStorage; never logged, echoed, or committed.
- **pilot-api is never auto-started** by the extension; local↔prod pushes are prohibited.

---

## 13. Acceptance criteria

1. `BackendRouter` resolves `local-brain | remote-pilot | auto` and the status bar shows the **resolved** backend + health; mode changes re-negotiate.
2. In `remote-pilot`, chat streams from `POST /api/pilot/chat/stream` with live token/plan rendering and correct terminal state; `CancellationToken` aborts the stream and cancels server work.
3. Every pilot-api request carries `Authorization: Bearer <token>` (from SecretStorage) and `X-Request-Id`; 401s map to `AUTH_REQUIRED/INVALID` with a `Set Token` affordance.
4. Capability negotiation gates features; an older pilot-api without `/capabilities` degrades gracefully with a logged downgrade (no silent assumption).
5. A pending action can be **approved, rejected, and resumed** from the extension; replayed streams never re-prompt a decided `actionId`; decisions survive a reconnect.
6. Timeouts, capped idempotent retries, and bounded SSE reconnect (via `runId` reconciliation) all behave per §5; non-idempotent actions never blind-retry.
7. All backend failures render through the §6 taxonomy; no stack traces to users; `requestId` in logs.
8. **No-silent-fallback** test passes: `remote-pilot` + failing mock ⇒ surfaced `PilotError`, not stub output.
9. brain stub path unchanged; `local-brain` fully offline.
10. **Both** `npm run test:integration` and `npm run test:vsix` green, including the new remote-mode suites against the deterministic mock pilot-api.
11. No hardcoded backend URLs/ports in feature code; all via config with documented defaults.
12. Secrets never appear in logs, settings.json, or the packaged VSIX.

---

## 14. File-level implementation map (extension repo)

**New — services**
- `src/services/pilotApiClient.ts` — pilot-api transport: Bearer auth (SecretStorage), `X-Request-Id`, `AbortController` timeout/cancel, SSE parser, JSON calls (v1, proposed-edits, pending-actions, replay). Mirrors `brainClient.ts` ergonomics.
- `src/services/backendRouter.ts` — mode resolution, backend selection, capability-gated dispatch, no-silent-fallback enforcement.
- `src/services/capabilities.ts` — health + `/api/pilot/v1/capabilities` negotiation, degrade-gracefully probe, per-(url,token) cache + TTL.
- `src/services/pilotErrors.ts` — `PilotError` taxonomy + `toUserMessage()` + action mapping (§6).
- `src/services/correlation.ts` — `requestId`/`actionId`/`runId` helpers, in-flight idempotency set.
- `src/services/approvals.ts` — pending-action list/present/approve/reject/resume + replay rendering + `actionId` dedupe.
- `src/services/secretToken.ts` — SecretStorage read/write; `migrapilot.setToken` command handler.

**New — tests**
- `src/test/support/mockPilotApi.ts` — deterministic HTTP+SSE mock of pilot-api.
- `src/test/suite/pilotApiClient.test.ts`, `backendRouter.test.ts`, `approvals.test.ts` — new suites (dev + VSIX, `IS_VSIX`-aware).

**Modified**
- `package.json` — new `migrapilot.*` settings (§2), `migrapilot.setToken` command; activation events; (test scripts unchanged).
- `src/extension.ts` — construct `BackendRouter`, wire `setToken`/`repairConnection`, negotiate on activate, status-bar resolved backend; implement local-only brain auto-start (§9).
- `src/chat/migrapilotParticipant.ts` — route via `BackendRouter`; SSE streaming in remote mode; `CancellationToken` bridge.
- `src/commands/explainSelection.ts`, `fixDiagnostics.ts`, `generateCommitMessage.ts` — dispatch through `BackendRouter`; map edits to `/api/pilot/proposed-edits` in remote mode.
- `src/services/statusBar.ts` — resolved-backend + degraded state rendering.
- `src/services/proposedEdits.ts` — remote proposed-edits path alongside brain `edit.preview/apply`.
- `src/test/suite/extension.test.ts` — remote-mode variants against the mock; `IS_VSIX` guards retained.

**Coordinated on-host (NOT this repo)**
- pilot-api: add `GET /api/pilot/v1/capabilities`; confirm `pending-actions` idempotency + `X-Request-Id` echo. Tracked as a separate on-host change (§12).

---

## 15. Implementation phases

| Phase | Deliverable | Exit gate |
|---|---|---|
| **P0** | ✅ DONE (2026-07-15): canonical decision locked; conflicting lines reclassified; capability contract v1 finalized ([`pilot-api-capabilities.v1.md`](./pilot-api-capabilities.v1.md)); ownership explicit; capability-failure behavior defined | Owner sign-off ✅ |
| **P1** | 🚧 IN PROGRESS: ✅ `pilotApiClient` + `capabilities` + `pilotErrors` + `correlation` + deterministic `mockPilotApi` + `pilotApiClient.test.ts` (11 unit tests, `npm run test:unit`, all green). Remaining: `secretToken` (vscode SecretStorage adapter) + vscode-backed `PilotApiConfig` (deferred to P2 wiring). Default still `local-brain`; nothing wired into activation. | new unit suite green, both gates green, default still local |
| **P2** | ✅ DONE (2026-07-15): `BackendRouter` (local-brain/remote-pilot/auto, resolve-once, no-fallback) + `tokenStore` + vscode adapters (`pilotConfigVscode.ts`: SecretStorage token, config, LocalChatBackend) + chat-participant routing (local buffered / remote SSE + cancellation bridge) + status-bar backend display + settings/commands (`setToken`/`clearToken`, default stays `local-brain`). 20 new unit tests + 2 Extension-Host remote tests. Legacy `mode` aliases map conservatively (`hybrid`/`offline`→local, `cloud`→remote) so remote is strictly opt-in. | remote chat streams; no-fallback passes; all 3 gates green |
| **P3** | ✅ DONE (2026-07-15): capability-gated per-command routing (`commandCapabilities.ts` + `evaluateCapability`) for explainSelection (remote SSE, present-only-on-done), fixDiagnostics (gate → remote proposed-edits fetch → existing approval/apply boundary), proposed-edits (read-back verification via `editVerification.ts`), diagnostics sync (backend-aware). Local paths intact + default. Cancellation via `withCancellableProgress`. Denials → structured `PilotError`, no fallback. 9 new unit tests (40 total) + 2 host tests (explain-success, fix-capability-denied). | per-command mock tests + 3 gates green ✅ |
| **P4** | ✅ DONE (2026-07-15): approval lifecycle + replay-safe recovery. `actionState.ts` (state machine, fail-closed `canApply`), `approvalsClient.ts` (list/get/approve/reject/resume + `reconcileRun`/`approveResumeAndReconcile`, runId source-of-truth, requestId=idempotency key), `openSse` refactor for exec-stream watch, `INVALID_STATE` error, stateful mock store (approve/reject/resume/idempotency/runs/exec-drop + store inspection), minimal `reviewApprovals` command, `ApprovalsClient` exposed on the ext API. 16 unit + 4 host tests (approve→exec-once, reject→no-exec, reconnect-after-SSE-loss, replay-refusal), all asserting mock STORE state. Single-use execution, no mutation-replay on reconnect. | approve/reject/resume + reconnect tests green; all 3 gates green ✅ |
| **P5** | ✅ DONE (2026-07-15): local-brain lifecycle. `brainLifecycle.ts` (vscode-free DI: probe/adopt/spawn + bounded readiness-wait w/ backoff, owned-PID tracking, conflict refusal, graceful SIGTERM→SIGKILL of ONLY the owned process), `brainLifecycleVscode.ts` (real launcher). Config `brainAutoStartCommand`; wired into activation (non-blocking, local only), `repairConnection` (re-start), `deactivate` (shutdown), status-bar degraded state, `lifecycle` on ext API. pilot-api NEVER auto-started. 10 unit + 1 host test (real spawn→readiness→adopt→shutdown). | readiness/shutdown tests green; all 3 gates green ✅ |
| **UI-hardening** | ✅ DONE (2026-07-15): approval-card consent view. `approvalDelta.ts` (delta-not-object via `diffObjects`; omit internal/correlation/approval fields; redact sensitive values; create/update/delete/append/replace with unambiguous partial-vs-full wording; null vs omitted). `PendingAction.change`; consent doc in `reviewApprovals`; `renderConsent` on API. 9 unit + 1 host test. Display-only, no lifecycle/semantics change. | consent shows only user-facing delta; 3 gates green ✅ |
| **P7** | ✅ DONE (2026-07-15): model-provider integration. Provider-neutral `ModelProvider` (`src/providers/`): `StubModelProvider` (deterministic, default), `OpenAiCompatProvider` (real SSE `/chat/completions`: streaming, cancellation, timeout, usage + rate-limit metadata, structured errors → PilotError, key never logged), `providerFactory` (no silent fallback). `providerConfigVscode.ts` (SecretStorage key, `ProviderLocalChatBackend` → router.local; default provider `stub` preserves default). Settings + `setProviderKey`/`clearProviderKey`/`providerInfo`; provider identity in diagnostics; `provider()` on API. Mock OpenAI-compatible server; 17 unit + 2 host tests (real streamed completion + correlation + cancellation). | real chat run + correlation + cancellation proven; all 3 gates green ✅ |
| **generateTests** | ✅ DONE (2026-07-15): provider-backed, non-destructive. `generateTests/proposal.ts` (parse/validate/fingerprint/apply+read-back, fs-injected: paths-inside-ws, create-no-overwrite, update-only-test-files, leak guard, partial fail-closed, changed-after-review refused), `generateTests/framework.ts` (detect framework from trusted pkg config + CONSTRAINED command template — provider never picks a shell command; deterministic stub fixture). `commands/generateTests.ts` (gather→provider→parse→validate→preview→confirm→apply→read-back→run→report; remote capability-gated `CAP_GENERATE_TESTS`, no local fallback; cancellation before apply = no write). Command + `generateTests()` on API. 23 unit (incl. 5 mock-provider) + 3 host tests (write+read-back, cancel→no-write, unsafe refused; assert workspace directly). | preview/dry-run + read-back; 3 gates green ✅ |
| **commit messages** | ✅ DONE (2026-07-15): provider-backed, strictly READ-ONLY. `commitGen/git.ts` (read-only `GitRunner` + `assertReadOnly` allow-list; staged/unstaged/numstat/recent-subjects — never add/commit/amend), `commitGen/prepare.ts` (secret redaction before transmission; binary/lockfile/generated/oversized → summarized; bounded total; conservative Conventional-Commit detection), `commitGen/sanitize.ts` (strip fences/control/fabricated-trailers/command-lines/invented-issue-refs/unevidenced-scope+`!`; subject length policy; deterministic stub fixture). `commands/generateCommitMessage.ts` (staged-first; no-staged → precise result with NO provider request; remote capability-gated `CAP_COMMIT_MESSAGE`, no local fallback; provider failure → error, no fabricated message; preview before clipboard; **never mutates repo**). `generateCommitMessage()` on API. 24 unit (17 core + 7 mock-provider) + 3 host tests (staged→generated, no-staged→precise+0-requests, failure→error — assert git HEAD+staged unchanged before/after). | read-only; repo never mutated; 3 gates green ✅ |
| **P6** | HELD (owner decision, 2026-07-15): flipping the default to `auto` is an operational policy decision, not code-completeness. See §16 for the required operational-validation evidence set that must be collected first. Default stays `local-brain` + provider `stub`. | §16 evidence set collected |

---

## 16. P6 readiness — operational-validation evidence set (HELD)

**Release posture (2026-07-15): _Ready with explicit backend configuration; not yet approved for automatic backend selection by default._** Default stays `local-brain` with the deterministic provider `stub`. Per-path correctness is proven on three green gates; what is NOT yet proven is that automatic backend selection is the best *default* across real user environments. Collect this bounded evidence before P6 is reconsidered:

- [ ] Repeated `auto` resolutions across: clean start, restart, offline, invalid token, foreign port occupant (pilot-api on 3377), pilot-api outage, provider failure.
- [ ] Stable selection for the full session — `auto` resolves once (activation/repair), no per-request drift.
- [ ] No silent fallback under any production-intent failure (remote failure → surfaced `PilotError`, never stub output).
- [ ] Clear status-bar state + actionable recovery for each degraded/unavailable case.
- [ ] No orphan brain processes after interrupted Extension Host runs (see hardening item — now deterministic).
- [ ] Packaged-VSIX validation on >= 1 non-WSL environment, if a supported target.
- [x] **Structured local diagnostics** recording which backend was selected and why, without secrets — **SURFACE BUILT** (`backendDiagnostics.ts`; observational `onResolution` router hook; `migrapilot.showBackendDiagnostics` command + `backendDiagnostics()` API; bounded 20 events; sanitized by construction).

**Deterministic evidence collected (mock-backed): `npm run test:ops` — 11/11 scenarios, 3× repeatable-identical.** See [`p6-operational-evidence.md`](./p6-operational-evidence.md). Covers clean-activation, local-unavailable, foreign-port, invalid/missing token, pilot-api outage, provider failure, explicit repair/recovery, session-stability (no change without repair), auto-ready, auto-degraded→local, and auto-start→shutdown port state. Every scenario asserted `noSilentFallback`. **Still outstanding:** packaged-VSIX on a non-WSL host, and real-deployment (non-mock) repeatability over restarts/outages. **P6 remains HELD; default `local-brain` + `stub`.**

Flipping the default to `auto` remains an owner decision even after this set is collected.

### Tracked hardening item — stale brain on port 3988 (RESOLVED in test env)

- **Symptom:** the P5 lifecycle host test auto-starts a brain on 3988; the real launcher spawns it non-detached, so an interrupted Extension Host run (timeout/kill before teardown) leaves the child reparented to init -> the next gate's lifecycle setup sees 3988 occupied and fails.
- **Note:** the lifecycle *code* is correct (it detects the conflict and refuses to adopt a foreign occupant). The gap was purely test-environment determinism.
- **Fix (test harness only):** `src/test/support/staleBrains.ts::killStaleBrains()` sweeps test brain ports (3988, 3991), scoped to `brain-service` processes via `/proc/<pid>/cmdline` (never collateral-kills a real service). Called before launch and in the finally of both `runTest.ts` and `runTestVsix.ts`. Verified: planting a brain on 3988 then running the gate is green, and no orphan remains after.
