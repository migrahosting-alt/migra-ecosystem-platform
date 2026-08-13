# Reusing the canonical governed-coding modules

`apps/vscode-extension` already solves durable-run observation correctly. Its six
core modules import **zero** `vscode` symbols (verified by grep), and
`codingRunClient.ts` states this is deliberate: *"vscode-free on purpose, so the
whole contract is testable under plain `node --test`."*

**Do not fork their domain behaviour.** The intended shape is a third adapter,
not a second implementation:

```
domain / client logic  →  shared package        (to be extracted)
VS Code adapter        →  governedCodingUiVscode.ts   (exists, 86 lines)
React / Next adapter   →  to be written               (Phase 1)
```

That split already exists — `governedCodingUi.ts` (123 lines, portable) versus
`governedCodingUiVscode.ts` (86 lines, the VS Code half) — which is what makes a
React adapter the natural extension point.

## Modules to lift

| Module | Lines | Responsibility |
| --- | --- | --- |
| `codingRunClient.ts` | 291 | Typed client; wire mirrors; 12-member `CodingResult` union |
| `codingRunPoller.ts` | 132 | Bounded polling (semantics below) |
| `codingSurfaceModel.ts` | 298 | Durable snapshot → UI model mapping |
| `codingWorkflow.ts` | 243 | Start → approve → poll → report orchestration |
| `approvalDelta.ts` | 229 | Approval/scope change detection between revisions |
| `governedCodingUi.ts` | 123 | Portable UI seam |

Source: `apps/vscode-extension/src/services/` in the canonical repo.

## Poller semantics that must survive the port

These are load-bearing. A React rewrite that loses any of them is a regression:

- **No overlapping requests.** Each poll is awaited, so out-of-order snapshots
  cannot render a state the run has already left.
- **Revision-based updates.** `onSnapshot` fires only when `revision` changes —
  never repaint an approval panel someone is reading.
- **Bounded backoff.** 400 ms → 4 s, ×1.6 while the revision is static, ×2 on
  transport failure.
- **A timeout does not imply completion.** The 30-minute deadline returns
  `reason: 'deadline'`; the durable record still holds the truth.
- **Explicit stop reasons.** `terminal · awaiting_approval · disposed · corrupt ·
  not_found · deadline · transport_failure`.
- **Durable state is authoritative.** *"Progress is read from the DURABLE
  record, never inferred from elapsed time."* Corrupt records are never retried.

`sleep`, `now`, and `signal` are injectable, so the poller drops into a React
effect unchanged and stays deterministically testable.

## Contract types

`src/server/brain/contracts.ts` currently holds wire mirrors lifted verbatim from
`codingRunClient.ts`. When a shared `packages/coding-client` is extracted, delete
that file and import from the package instead. Until then the two must not drift.

`MigraTeck/packages/api-contracts` covers auth/org/security only — there is no
Brain DTO package today, which is why the extension client is the de-facto
contract.

## Consumer scope: observation only

Phase 1 exposes durable runs **read-only**. `src/server/brain/operations.ts`
deliberately has no start / scope-decision / cancel operation: starting a run
requires a `workspaceRoot` the browser does not have, and fabricating one would
weaken the filesystem governance contract the Brain enforces
(`403 workspace_not_permitted`).

UI must gate on `capability.available` **and** `workspaceRootsConfigured > 0`,
and must distinguish `capability_unavailable` from `not_found` — telling a user
their run vanished when the feature was simply off is a lie the type system can
prevent.
