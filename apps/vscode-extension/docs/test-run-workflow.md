# Structured test runs

`MigraPilot: Run Tests` → `POST /api/ai/test-run` → the existing `commandRun` executor

## What makes it safe

A request names a **script**, never a command line. The script must already be a key in the
project's own `package.json`, so the set of runnable things is exactly what the project
declared for itself. No field becomes a shell string, and nothing can reach a program the
project did not define.

Execution is delegated to the **same executor as the ad-hoc lane**, allowlist untouched.
`npm` was already allowlisted, so `npm run <script>` needed no widening — and if it had not
been, the right answer would have been to refuse, not to widen.

Like `command.run`, `test.run` is **absent from the generic tool registry**: the model's tool
loop cannot start a test run on its own initiative. It is reached when a person asks.

## A refusal is not a failing suite

| status | meaning |
|---|---|
| `passed` / `failed` | the suite **ran** and reported |
| `timeout` | the suite exceeded its limit and **was stopped** |
| `refused` | **nothing ran** — no discoverable script, unknown script, containment or policy refusal |

Collapsing `refused` into `failed` would tell someone their code is broken when nothing
executed. The two render differently and are never merged; a refusal carries no failures and
no totals.

Discovery fails closed: no `package.json`, no test script, an unknown script, or several test
scripts with no standard one all refuse and say why. An unknown script is **never** silently
swapped for a different one.

## Two defects found by live acceptance

**The timeout did not stop the work.** `npm run x` spawns a grandchild. Killing only `npm`
left the grandchild holding the stdout pipe, so `close` never fired: a 2 000 ms timeout
returned after **60 032 ms** — and a suite that never ends would have hung forever. The child
now gets its own process group and the timeout kills the tree. Re-verified live: **2 038 ms
wall clock** for the same case. The engine test file dropped from 61 s to 4.9 s.

**A nested runner reported "passed" without running anything.** `NODE_TEST_CONTEXT` is
inherited; a child `node --test` sees it, logs *"run() is being called recursively … skipping
running files"*, runs nothing, and exits 0 — which reads as a passing suite. Inherited
test-runner state is now stripped from the child environment. This removes inherited state;
it grants nothing.

**Discovery was not contained.** `readScripts` resolved `cwd` before any containment check,
so a traversal could read a `package.json` outside the workspace and disclose its script
names without executing anything. Discovery now passes through the same `containedPath`
chokepoint as execution.

## Verified live

| criterion | result |
|---|---|
| passing suite | `passed`, exit 0, totals `{passed: 2, failed: 0}` |
| intentionally failing test | `failed`, exit 1, `{passed: 1, failed: 1}`, named **"the deliberately broken expectation"** |
| edit → rerun | same command rerun → `passed`, failures cleared |
| timeout | `timeout` in **2 038 ms** against a 60 s suite |
| refusal — unknown script | `refused`, nothing executed, *"…is not a script in this project (test scripts here: test)"* |
| refusal — no test script | `refused`, *"this project declares no test script"* |
| refusal — cwd escape | `refused`, *"escapes the workspace root"* |

18 engine tests against real passing, failing and hanging projects; 15 extension tests.
Extension **809/809**. No Agent Mode dependency, no shell, no widened allowlist.

## Registration is asserted, not assumed

A previous slice shipped a command that **typechecked and never registered** — the
registration had landed inside another `registerCommand` call as its third `thisArg`
argument. This lane's acceptance asserts the command is contributed in `package.json` **and**
wired to its handler in `extension.ts`, alongside the global check that no `registerCommand`
nests inside another.
