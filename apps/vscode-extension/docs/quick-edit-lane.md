# The lightweight edit lane

`MigraPilot: Quick Edit` → engineer proposes → you confirm the diff → `fs.applyChangeset`

## Why this is not a governed coding run

```text
Quick edit lane                       Governed coding run / Agent Mode
------------------------------------  -------------------------------------------
a few files, bounded byte budget      unbounded scope within its recipe
one propose -> one apply              plan, children, validation, repair loop
user confirms the exact diff          checkpoint / scope-decision state machine
no autonomous follow-up               autonomous multi-stage execution
```

The bounds are refusal thresholds, not suggestions: **5 files, 64 KiB**. A change that
outgrows them is refused with "use a governed coding run" — and refused *before* the user is
asked to approve anything, because asking for approval on something the lane will reject is
worse than refusing early.

## No second mutation path, no new approval

Every write goes through the engine's existing changeset machinery, unchanged:

| stage | tool | property |
|---|---|---|
| propose | `fs.proposeChangeset` | read-only, hashes the proposal, captures pre-state |
| apply | `fs.applyChangeset` | `approvalRequired`, atomic, all-or-nothing, rollback |

The extension **never writes workspace files** in this lane — asserted by a test that
forbids `node:fs`, `writeFileSync`, `workspace.fs.writeFile`, `WorkspaceEdit` and `applyEdit`
in both lane modules. A "quick" lane that wrote directly would bypass containment, staleness
detection and rollback in one move, which is exactly the machinery that makes a small edit
safe to accept.

No approval was added. `fs.applyChangeset` is already `approvalRequired` and the existing
mint → consume handshake in `changesetApply.ts` is reused as-is.

## Verified live against a running brain-service

| criterion | result |
|---|---|
| real two-line edit | proposed read-only (file untouched), then `approval_required` → `executed`; `const a = 1` → `const a = 10` |
| multi-file within bound | 2 files (`app.js` + `lib.js`) applied atomically |
| stale content | refused; the externally-changed file was **not** clobbered |
| path containment | `../escaped.js` refused; no file escaped the root |
| **rollback / no partial write** | 2 ops, second went stale before apply → **`one.txt` unchanged**, nothing partially written |
| Agent Mode unchanged | `command.run` via `/api/ai/tools` still **403 CAPABILITY_DENIED** |

Automated: 13 lane tests covering bounds-before-approval, binary refusal, fail-closed,
apply-time refusal, decline, and the no-direct-write guarantee. Extension suite **778/778**
with `check-brain-transport` still reporting no second Brain path.

## Known limitation

Refusals surfaced through `/api/ai/tools` arrive as `TOOL_FAILED — "The tool could not
complete."`. The engine knows precisely why (stale sha, containment, rollback) but that
reason is not carried through the tool-execute envelope, so the lane can only report that
the change was **not** applied, not which rule stopped it. The safety property holds; the
diagnosis is coarse. Worth a follow-up on the envelope, not on this lane.
