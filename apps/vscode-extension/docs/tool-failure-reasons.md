# Structured refusal reasons for governed tools

`executeToolCore` used to collapse every tool failure into `TOOL_FAILED — "The tool could
not complete."` The safety property was intact and the diagnosis was useless: a user could
not tell *"someone edited that file under me"* from *"that path escapes the workspace"*
from *"the write rolled back"*.

The engine already knew — it throws `ChangesetError('STALE', …)` and
`WorkspaceToolError('PATH_ESCAPE', …)` with stable codes. `failed()` was discarding them.

## What crosses, and what still does not

A failure response now carries a stable `reason` plus a safe `message`:

```json
{ "code": "TOOL_FAILED", "reason": "STALE_CONTENT",
  "error": "A file changed after the change was proposed, so it was not applied. …" }
```

**The raw `error.message` is never forwarded.** Those strings interpolate absolute paths,
proposal hashes and internal stage names — exactly what the generic message existed to
withhold, and that protection is preserved. The message a client sees is written in
`brain-service/src/engine/toolFailureReason.ts`, not at the throw site.

Also never forwarded: stack traces, and `ChangesetError.reverseMaterial` (prior file
*content*, kept server-side for approval-gated recovery). `ChangesetError.details` **is**
forwarded for rollback failures, because its own contract says it carries "safe, bounded
counts … never paths or content" — and only when it matches that exact shape.

## Vocabulary

`STALE_CONTENT` · `PATH_NOT_CONTAINED` · `ROLLED_BACK` · `INCONSISTENT_STATE` ·
`CONFLICTING_EDITS` · `PROPOSAL_EXPIRED` · `OPERATION_NOT_PERMITTED` · `TOO_LARGE` ·
`TARGET_MISSING` · `TARGET_EXISTS` · `UNSUPPORTED_TARGET` · `INVALID_REQUEST` · `TIMEOUT` ·
`CAPABILITY_DENIED` · `APPROVAL_REQUIRED` · `INTERNAL_ERROR`

`ROLLED_BACK` and `INCONSISTENT_STATE` are deliberately distinct: a clean rollback means the
workspace is unchanged, a failed rollback means it may not be. Reporting the second as the
first would be the most dangerous message in this list.

## No gate changed

Adding a reason changes only how a refusal is *described*. Every gate keeps its decision,
success responses are unchanged (no `reason` field appears on success), and an unmapped
error still yields `INTERNAL_ERROR` with the original generic sentence.

## Consumer side

`changesetApply.ts` gained `applyApprovedChangesetDetailed()`, which keeps the engine's
`reason` and `message`; `applyApprovedChangeset()` remains as a wrapper so existing callers
are untouched. The quick-edit lane shows the engine's message and appends the stable reason,
and falls back to its generic sentence when an older engine sends nothing — it never invents
a cause on the engine's behalf.

## Verified live

| case | reason | outcome |
|---|---|---|
| file edited after propose | `STALE_CONTENT` | not applied; external content preserved |
| `../escaped.js` | `PATH_NOT_CONTAINED` | refused; nothing outside the root |
| two ops, one stale | `STALE_CONTENT` | **`one.txt` unchanged** — no partial write |
| `command.run` via `/api/ai/tools` | `CAPABILITY_DENIED` | Agent Mode gate intact |
| unknown proposal hash | `PROPOSAL_EXPIRED` | refused |
| successful apply | *(no reason field)* | `status: executed`, keys unchanged |

No refusal contained the workspace path or a proposal hash.

**Note on the rollback case:** the engine detects staleness in its pre-flight re-validation,
*before* attempting any write, so a live two-op conflict reports `STALE_CONTENT` rather than
`ROLLED_BACK`. That is the stronger behaviour — nothing is written at all. The
`PARTIAL_WRITE → ROLLED_BACK` mapping is covered by unit test; inducing it live would require
a mid-write failure that cannot be provoked safely.

11 classifier tests, including non-leakage of paths, hashes, stacks and reverse material.
Extension 780/780; brain-service unchanged apart from the 57 pre-existing Postgres failures.
