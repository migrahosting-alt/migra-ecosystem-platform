# The Brain release gate was red. Diagnosis, and the narrow repair.

## The failure, verbatim at HEAD `f1678e9b`

```
not ok 1 - a request naming an existing product must be told to locate the real owning module first
    The input did not match the regular expression /locate the REAL owning code/
not ok 2 - the prompt distinguishes an operational request from a code change
    The input did not match the regular expression /operational rather than a code change/i
not ok 3 - build-from-scratch guidance still applies when nothing existing is named
    The input did not match the regular expression /brand-new script, page, component or app with NO existing counterpart/
```

| | |
| --- | --- |
| failing gate | `docs/migrapilot/deploy-brain.sh` step 3 — `npm test`, "the full gate, not a subset" |
| failing tests | 3, all in `apps/brain-service/test/engineerPromptGuardrails.test.ts` |
| owning module | `apps/brain-service/src/engine/engineer/engineerRuntime.ts` — the engineer protocol prompt |
| why it blocks a chat release | one deployable, one gate. The Brain serves chat *and* the engineer loop, and the gate is deliberately the whole suite. Nothing is miscoupled about that: the test simply does not pass at HEAD. |

## Which of the four it is

**Incorrect lane coupling, caused by a partial commit — and the partial commit was mine.**

Proven, not inferred:

```
$ git show 55993942 --stat -- apps/brain-service/test/engineerPromptGuardrails.test.ts
 .../test/engineerPromptGuardrails.test.ts | 51 ++++++++++++++++++++++
 1 file changed, 51 insertions(+)          ← the commit CREATED the file

$ git show 55993942 --stat -- apps/brain-service/src/engine/engineer/
 (empty)                                    ← and never touched the runtime

$ git log -S "locate the REAL owning code" -- .../engineerRuntime.ts
 (empty)                                    ← the string was NEVER committed

$ grep -c "locate the REAL owning code" .../engineerRuntime.ts     # working tree
 1                                          ← it exists, uncommitted, in the engineer lane
```

And the decisive check — the same three tests, same commit of the test file:

```
against the WORKING TREE  (engineer lane's uncommitted runtime present):  3 pass
against committed HEAD    (runtime absent):                              3 fail
```

So:

- **not** a genuine shared Brain defect — the prompt at HEAD is the older prompt; it works, it
  just lacks the newer guidance. Nothing is broken by its absence.
- **not** a stale test assumption — the assertions are satisfied by real code that exists today.
- **not** a fixture or isolation problem — the test injects its own `complete`, `executeTool`
  and `listFiles`, and is deterministic.
- **it is** a test that was committed without its implementation. `55993942` — a chat-assistant
  commit about email grounding — swept in the engineer lane's new test file (and a swathe of
  `apps/vscode-extension/*`) from a shared working tree. HEAD has been internally inconsistent,
  and its gate red, since **2026-09-11 17:31 -0400**.

## The repair

Remove the file from HEAD — undoing the accidental creation in my own lane. Nothing else.

Deliberately NOT done:

- **not suppressed, skipped or weakened.** No `skip`, no `todo`, no loosened regex, no assertion
  deleted. The file is removed from HEAD in full and relands in full.
- **no engineering behaviour changed.** Not one source file is touched. The engineer prompt at
  HEAD is exactly what it was.
- **the guardrail is preserved.** It lives in `engineerRuntime.ts` in the engineer lane's working
  tree, untouched, and lands with its test when that lane commits.
- **the runtime was NOT committed on their behalf.** That would have been committing another
  session's unfinished work.

## Relanding it — one line

The content is in git history at `55993942`, and preserved verbatim beside this file as
`engineerPromptGuardrails.test.ts.preserved.txt` (51 lines, byte-identical).

When the engineer lane commits `engineerRuntime.ts`, it should restore the test in the **same
commit**:

```sh
git show 55993942:apps/brain-service/test/engineerPromptGuardrails.test.ts \
  > apps/brain-service/test/engineerPromptGuardrails.test.ts
git add apps/brain-service/test/engineerPromptGuardrails.test.ts \
        apps/brain-service/src/engine/engineer/engineerRuntime.ts
```

Both together, which is how it should have landed the first time.

## The lesson worth keeping

A commit that stages by hand from a working tree shared with another lane can take half of
someone else's change. Half of a test-plus-implementation pair is worse than neither: it leaves
`main` unable to build its own release, and the failure surfaces days later in a completely
unrelated deploy.
