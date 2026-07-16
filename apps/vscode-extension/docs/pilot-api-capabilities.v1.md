# pilot-api Capability Contract — v1 (FINALIZED)

**Endpoint:** `GET /api/pilot/v1/capabilities`
**Contract version:** `1` (this document is the source of truth for both sides)
**Status:** Locked for P1. Changes require a `protocolVersion` bump and a new revision of this file.

## Ownership

| Concern | Owner |
|---|---|
| **Endpoint implementation** | **pilot-api owner / on-host deployment path.** pilot-api is on-host source-of-truth (gitignored in the dev monorepo); this endpoint is implemented and deployed **on-host**, never pushed local→prod. |
| **Contract definition (this schema)** | Shared. Locked here; consumed by the extension; implemented by pilot-api to match. |
| **Extension consumption** | `apps/vscode-extension` (canonical). The extension **consumes** capabilities; it must never infer them from `serverVersion` or hardcoded assumptions. |

## Design rules

- **Separate from health.** `/health` (and `/health/ready`) prove *reachability/readiness*. `/api/pilot/v1/capabilities` proves *supported protocol behavior*. The extension calls both (readiness first, then capabilities) and never conflates them.
- **Authenticated by default.** The endpoint requires `Authorization: Bearer <JWT>` (same `requireAuth` path as the rest of `/api/pilot/v1`). Rationale: capabilities describe what *this authenticated actor* may do, and avoid leaking protocol surface to unauthenticated callers. A reduced **unauthenticated** profile is exposed **only** if a concrete operational need arises — and if so, it lives at `/health`-style reachability, not here.
- **No sensitive content.** The response MUST NOT contain secrets, provider credentials, model/provider names, internal hostnames/topology, or an unrestricted raw tool inventory. Tools are exposed as **coarse operation classes**, not a full registry.
- **Additive evolution.** New capability keys are additive within `protocolVersion: 1`. Removing/renaming a key, or changing a field's meaning, requires bumping `protocolVersion`.

## Response schema (v1)

`200 OK`, `application/json`:

```jsonc
{
  "protocolVersion": 1,               // integer; contract version this body conforms to
  "serverVersion": "36.4.1",          // informational only; extension MUST NOT gate on it
  "chatTransport": "sse",             // "sse" | "ndjson" | "buffered"
  "streaming": true,                  // token/plan streaming supported
  "approvals": true,                  // pending-actions gating supported
  "rejectResumeReplay": {             // granular approval lifecycle support
    "reject": true,
    "resume": true,
    "replay": true
  },
  "cancellation": true,               // client abort cancels server-side work
  "correlation": {                    // request-correlation support
    "requestIdHeader": "X-Request-Id",// header the server honors; null if unsupported
    "echoesRequestId": true           // whether responses/SSE frames echo it
  },
  "idempotency": {                    // safe-retry support for mutating actions
    "supported": true,
    "keyHeader": "X-Request-Id",      // header used as idempotency key; null if unsupported
    "scopes": ["pending-actions.approve", "pending-actions.reject", "pending-actions.resume", "v1.execute"]
  },
  "operationClasses": [               // COARSE classes, not a raw tool registry
    "chat", "plan", "execute",
    "repo.read", "workspace.read", "workspace.search",
    "proposed-edits", "knowledge.read", "memory.read",
    "approvals", "replay"
  ],
  "limits": {                         // advisory ceilings; extension surfaces/uses where relevant
    "maxRequestBytes": 1048576,       // matches express.json 1mb limit
    "maxRunDurationMs": 600000,       // server-enforced run ceiling (null if none)
    "streamIdleTimeoutMs": 60000,     // server closes idle SSE after this
    "maxConcurrentRuns": 4            // per actor (null if unlimited)
  },
  "deprecated": [                     // capabilities present but going away; may be []
    { "capability": "ndjson-chat", "removeAfterProtocolVersion": 1, "note": "pilot-web NDJSON path" }
  ],
  "unavailable": []                   // explicitly-off capabilities (e.g. ["memory.write"]); may be []
}
```

### Field coverage vs. the P0 requirement

| Required item | Field |
|---|---|
| protocol version | `protocolVersion` |
| server version | `serverVersion` (informational only) |
| supported chat transport | `chatTransport` |
| streaming support | `streaming` |
| approval support | `approvals` |
| reject/resume/replay support | `rejectResumeReplay.{reject,resume,replay}` |
| cancellation support | `cancellation` |
| request-correlation support | `correlation.{requestIdHeader,echoesRequestId}` |
| idempotency support | `idempotency.{supported,keyHeader,scopes}` |
| supported tool/operation classes | `operationClasses` (coarse) |
| max request/runtime limits | `limits.*` |
| deprecated/unavailable capabilities | `deprecated[]`, `unavailable[]` |

## Chat SSE event vocabulary (referenced by `chatTransport: "sse"`)

Documented event names the extension's SSE parser must handle (from `apps/migrapilot-vscode` prior-art + `chat.ts`): `conversation`, `provider`, `plan`, `tool-start` / `tool`, `usage`, `token`, `completed` / `done`, and an error frame. The parser treats unknown event names as ignorable (forward-compat) and derives run/plan state from the stream, never guessing.

## Extension behavior for non-conforming capability responses (P0 exit-criterion 6)

The extension resolves capabilities into one of four failure states, each with **defined** behavior. **In no case does a capability failure cause production behavior to silently fall back to the local brain stub** (exit-criterion 7): a remote failure yields a surfaced, correlated error or an explicit, user-visible mode/state change — never stub output masquerading as pilot-api.

| Case | Detection | Extension behavior |
|---|---|---|
| **Missing** | `404`/`501` on `/api/pilot/v1/capabilities`, or connection ok but route absent | Enter **conservative degraded capability set**: `streaming=false` (buffered chat only if any), approvals/replay **disabled**, correlation/idempotency assumed **absent**. Log an explicit downgrade line to the output channel (never silent). Features requiring proven capabilities are disabled with an explanatory message. Remote mode stays remote — no stub fallback. |
| **Malformed** | non-JSON, JSON-parse failure, or schema validation failure (missing `protocolVersion`, wrong types) | Treat as **`CAPABILITY_MALFORMED`** error. Do **not** partially trust the body. Fall back to the same conservative degraded set as *Missing*, log the validation error + `requestId`, and surface a `Repair Connection` affordance. No stub fallback. |
| **Incompatible** | `protocolVersion` ∉ extension's supported set (v1 supports `protocolVersion === 1`); or `minExtensionVersion` (if present) > extension version | Enter **`CAPABILITY_INCOMPATIBLE`** state: remote features **disabled**, status bar shows an incompatible-backend warning with the observed vs. required versions, and the user is prompted to update the extension or the server. The extension does **not** attempt best-effort protocol guessing. No stub fallback. |
| **Unauthorized** | `401` (`AUTH_REQUIRED` / `INVALID_TOKEN`) on the capabilities call | Map to `AUTH_REQUIRED` / `AUTH_INVALID` (see plan §6). Offer `Set Token`. Remote features remain **blocked** until a valid token negotiates capabilities. No stub fallback; the user is told remote is unauthenticated, not silently served local output. |

**Caching & re-negotiation.** A successful capability response is cached per `(pilotApiUrl, tokenHash)` with a short TTL. It is re-negotiated on: mode switch, explicit `Repair Connection`, any `401`, or a request timeout. Cache entries never persist across a token change.

**Auto mode interaction.** When `migrapilot.mode = auto`, backend selection uses this negotiation **once at resolution time** (activation / repair), and the *resolved* backend is shown in the status bar. A capability failure while already resolved to `remote-pilot` does **not** silently swap to local mid-operation — it surfaces the state and requires an explicit re-resolution.
