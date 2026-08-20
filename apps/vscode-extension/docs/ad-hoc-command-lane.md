# The ad-hoc command lane

`MigraPilot: Run Command` → `POST /api/ai/command-run` → `tools/commandRun.ts`

## Why this is not Agent Mode

The difference is **authority**, not plumbing.

```text
Ad-hoc command lane                    Agent Mode
-----------------------------------    ------------------------------------------
single bounded command                 multi-step governed recipe
user-initiated, one per invocation     autonomous, with checkpoint semantics
existing allowlist, unchanged          recipe-scoped capability grants
no autonomous follow-up                broader coordinated workflow across stages
no file-mutation authority beyond      approval / checkpoint state machine
  what the allowed command itself
  legitimately performs
```

`POST /api/ai/tools` still refuses `command.run` with **403 CAPABILITY_DENIED**, and that
refusal remains load-bearing: it stops the **model's** tool loop (`executeToolCore` →
`agentRuntime`) from running commands on its own initiative. The new route is reached only
when a **person** invokes the command from the editor.

A user pressing "Run Command" and a model deciding to run one are different things. The
boundary between them is this lane's entire justification.

## No second executor

Every control lives in `tools/commandRun.ts` and is reused unchanged:

| control | behaviour |
|---|---|
| allowlist | `node`, `npm`, `npx`, `tsc`, `tsx` (or `MIGRAPILOT_COMMAND_ALLOWLIST`) |
| argv | array, spawned directly — `shell: false`, so there is no injection surface |
| `argv[0]` | must be a bare program name; path separators refused |
| cwd | contained inside `rootPath` by realpath; symlink escapes refused |
| external effects | `publish`, `deploy`, `release`, `push` refused regardless of allowlist |
| environment | `PATH`, `LD_PRELOAD`, `COMSPEC`… refused — they can substitute the executable |
| timeout | default 120 s, max 600 s; the process is killed and `timedOut` reported |
| output | 24 KiB cap per stream, `truncated` reported |
| secrets | redacted before the output leaves the tool |
| kill switch | `MIGRAPILOT_COMMAND_RUN=off` refuses every dispatch |

**Interactive commands are refused structurally, not by a name list.** stdin is `'ignore'`,
so a program waiting for input reads EOF and terminates instead of hanging the request open.
A denylist of "interactive programs" would be a guess; a closed stdin is a property.

## No local execution, and no approval ceremony

The extension never spawns a process. If the Brain Service is unreachable the command **does
not run**, and the lane says so — there is deliberately no local fallback, because one would
make every control above decorative.

No approval gate was added. The executor's policy already decides what may run; a second gate
on top of an already-policy-approved command would be ceremony without safety, which is the
exact cost this lane exists to remove. Agent Mode remains the path with checkpoint semantics.

## Shell syntax is refused, not reinterpreted

`npm test && echo done` would run as `npm` with the literal arguments `test`, `&&`, `echo`,
`done` — safe, but silently not what was meant. The extension refuses metacharacters
(`&&`, `||`, `|`, `;`, `>`, `<`, backtick, `$(`, `&`) with an explanation instead, so nobody
learns that chaining "works" until the day they depend on it. Quoting **is** supported,
because grouping an argument that contains spaces is not shell semantics.

## Verified

Live against a running brain-service on :3997:

| check | result |
|---|---|
| `node --version` | exit 0, `v22.22.1`, 13 ms |
| `npm --version` | exit 0, `10.9.4` |
| `npm publish` | 400 `UNSUPPORTED` — "external-effect action … refused" |
| `git status` | 400 `UNSUPPORTED` — "not on the allowlist (node, npm, npx, tsc, tsx)" |
| timeout 400 ms | `timedOut: true`, killed at 411 ms |
| `/api/ai/tools` `command.run` | **403 CAPABILITY_DENIED** — Agent Mode gate unchanged |

Automated: 17 route tests (`brain-service/test/commandRunRoute.test.ts`) driving the real
executor, and 17 lane tests (`vscode-extension/src/test/unit/adHocCommandLane.test.ts`).
Extension suite 765/765 with `check-brain-transport` still reporting no second Brain path.
