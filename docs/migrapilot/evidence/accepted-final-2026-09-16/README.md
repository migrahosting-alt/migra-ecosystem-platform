# Engineer foundations — local candidate, 2026-09-16

The provider used to publish final-answer tokens before the controller checked
repository evidence, unfinished plans, and answer quality. The extension appended
those tokens to an irreversible transcript. A rejected final therefore remained
visible even when the loop continued correctly.

The Brain now consumes provider streams privately and emits answer text only in
its controller-produced `final` event. Tool, plan and correction events remain
visible. The extension ignores legacy provisional `token` events and renders the
accepted final once, including machine-authored footers. This intentionally delays
answer text until acceptance; it does not disable provider streaming or tool progress.

## Verification

- Brain `npm test` (includes `tsc -b`): 3336 passed, 0 failed, 0 skipped on the final full run.
- Extension `npm test` (includes `tsc -b`): passed.
- Extension `npm run test:unit`: 928 passed, 0 failed, 0 skipped on final rerun.
- Focused controller and hardening tests: 56 passed before the new cases were
  consolidated into the existing `engineer.test.ts` for repository integrity.
- Extension renderer tests: 29 passed.
- `git diff --check`: passed on the changed source/test files.

Regression coverage includes streamed premature completion with an unfinished
plan, unsatisfied repository-map obligations, malformed final correction,
interrupted provider streams, legacy provisional tokens, accepted final footers,
error/EOF without acceptance, and duplicate final frames.

The initial Brain full run found the newly untracked test file and an existing
prompt assertion that matched spaces but not a line break. Tests were consolidated
into the tracked Engineer suite; the prompt assertion now accepts whitespace.
No existing prompt instructions were removed.

The extension suite also exhibited an intermittent pre-existing cross-file test
race: notification scanning read `src/interaction/__probe.control.ts` after another
test deleted it (ENOENT). This is separate from final delivery and remains a test
infrastructure issue even if a subsequent run passes.

## Browser evidence and reproduction

Run `node docs/migrapilot/evidence/accepted-final-2026-09-16/browser-rig.cjs`
from the repository root after building the extension. It prints a random loopback
port and a unique run ID. Navigate a fresh browser page to that address and read
`/checkpoints`. Confirm `window.__acceptanceRunId` equals the response's run ID.
Dispatch `streamStart`, then each checkpoint's messages through the window message
event, then `streamEnd`.

The rig executes the actual compiled `runEngineerTurn`, `shellHtml`, and
`shellScript`. It scripts Brain SSE input and stubs the VS Code host API. It uses
no production service or model. The browser run verified:

1. Neither provisional token checkpoint displays answer text.
2. Replanning and the source-read step remain visible.
3. The accepted report first appears at the final checkpoint, once.
4. Rejected text and a duplicate final never appear.

Run ID: `aae52488-c95e-4ebb-ad36-9c175324c833`.
Screenshot: [rendered-chat.png](./rendered-chat.png).

This is real browser rendering evidence for a local scripted harness. It is NOT
installed VSIX, live-model, restart-recovery, or production acceptance.

## Remaining foundation work from the owner's brief

### A — repository/tool grounding

Locally tightened in this batch. File-content evidence must match the requested
path and contain nonempty content. Manifest/config evidence needs a complete read;
package.json must parse, and runtime command evidence requires actual scripts.
An entrypoint needs source contents, not a directory listing. Search discovery
uses returned matches rather than string matching the entire response (which
mistook an echoed `*.test.ts` query for a found test).

Tests use real temporary repositories, manifests, source files and the production
workspace tools. They cover empty, truncated, partial, invalid and mismatched
reads, scriptless manifests, complete range reads, entrypoint listing versus
reading, and empty find results. The map loop test uses real Git/filesystem tools.

Remaining: conventional path recognition still bounds source/entrypoint coverage.
Repositories with unconventional layouts or genuinely absent test/manifest/config
categories need explicit absence evidence. Coverage is not semantic validation of
every sentence the model writes.

### B — controller-owned execution

Prose recovery and proposal-summary recovery now enter the same completion path
as ordinary protocol finals. Both are tested against unfinished plans; recovery
continues tool work before accepting a final. Existing malformed-output behavior
and useful proposal salvage remain covered. Only one final emission site remains.

Still unfinished: `runEngineerTask` initializes plan, transcript, evidence, caches
and retries per invocation. The route's task envelope is in memory. The extension
saves task cards through a memento, not executable controller checkpoints.
Restart-safe continuation needs a durable checkpoint/resume contract with identity,
workspace conflict, cancellation, approval and recovery tests. This batch does not
claim persistent autonomous execution across restarts.

### C — authoritative presentation

Locally fixed. Installed extension plus governed Brain end-to-end acceptance is
still required before promotion. No deployment or installation was performed.

### Final browser rerun

Run ID `c75a9d49-ba0e-4205-abc3-a9906672bde3` verified all three scenarios:
`/checkpoints` (legacy tokens), `/map-checkpoints` (incomplete manifest followed by
complete inspection), and `/recovery-checkpoints` (premature prose followed by
remaining test inspection and PLAN 2/2). Each uses the actual compiled adapter and
shell. The latter two also use the actual Brain controller and filesystem tools,
with a scripted streaming provider. No rejected answer appeared; each accepted
answer appeared exactly once.

Screenshots: [grounded map](./grounded-map-rendered-chat.png),
[completion recovery](./completion-recovery-rendered-chat.png).

## V1 release gates retained from the brief

All twelve remain release requirements, not an assertion of parity:
repository mapping; real inspection tools; persistent multi-step execution;
completion authority; multi-file proposals; governed apply/read-back; terminal
execution; test/build/lint repair; diagnostics; authoritative final delivery;
persistent tasks/conversations; and diff/review/apply UX.

In particular, `approveEngineeringTask` explicitly reports that no verification
command has run after apply. Passing this streaming slice does not establish a
complete edit/test/repair/retest loop or qualify the product to replace another
engineering agent. V2 delegation and external operations remain outside this batch.
