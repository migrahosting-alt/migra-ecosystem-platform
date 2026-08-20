# Read-only Git visibility

`MigraPilot: Git Status & History` → `git.overview` · `git.history` · `git.blame`

## Why this is not the command lane

The obvious shortcut was to add `git` to the ad-hoc command allowlist. That would have bought
arbitrary `git` execution — including `commit`, `push`, `reset` — to answer a read-only
question. `git` remains deliberately absent from that allowlist, and a test asserts it.

```text
command.run            "run this program, show me its output"     argv comes from a person
git.overview/history   "answer this question about the repository" argv is built server-side
```

Every git invocation is assembled from a fixed argv array in `gitInsight.ts`. **No request
field ever becomes a subcommand or a flag**, so there is no input shape that turns a read
into a write — and no denylist of dangerous verbs to maintain. `--` precedes every
caller-supplied path, and paths pass through the same `containedPath` chokepoint the
changeset engine uses.

## What it answers

| capability | answers |
|---|---|
| `git.overview` | branch, HEAD (full + short), detached, ahead/behind, staged/unstaged/untracked/conflicted counts, staged & unstaged line churn |
| `git.history` | bounded recent commits (1–100, default 20), optional contained path filter, observed `truncated` |
| `git.blame` | per-line attribution for a file or line range, capped at 2000 lines |

`git.status` and `git.diff` are **untouched**; this adds capabilities beside them.

## Truthfulness decisions

- **`untracked` counts FILES, not collapsed directories.** `--untracked-files=normal` reports
  an untracked directory as one entry: on the real repo that read **14** where **30** files
  were untracked. `all` costs the same (0.01s vs 0.02s on a 562-commit repo), so the truthful
  count is also the cheap one.
- **`ahead`/`behind` are `null` with no upstream, never `0`.** Zero would claim a comparison
  was made.
- **Branch comes from `symbolic-ref`**, so a repository with no commits still reports its
  branch — git itself says "On branch main" there — and detached HEAD is an observation
  rather than a string comparison.
- **Blame returns attribution only, never file content.** The caller already has the file.
- **`truncated` is observed** by fetching `limit + 1`, not guessed.
- A conflict is counted as `conflicted`, never silently folded into staged + unstaged.

## Verified live

Against a controlled repo and the real 562-commit workspace:

| check | result |
|---|---|
| overview vs real worktree | branch, HEAD, staged 6, unstaged 48, untracked 30 — **all match `git` exactly** |
| staged / unstaged / untracked | distinguished correctly from a deliberately mixed tree |
| history | correct HEAD; `limit: 1` returned 1 with `truncated: true` against 2 real commits |
| blame | real sha, author and ISO date for the right line |
| path scoping | `../outside.txt` and `/etc/passwd` → **`PATH_NOT_CONTAINED`** |
| mutation reachable? | `git.commit`, `git.push`, `git.checkout`, `git.reset` → **`UNKNOWN_TOOL`** |
| existing `git.diff` | intact |
| command lane | `git status` still refused: *"not on the allowlist (node, npm, npx, tsc, tsx)"* |

The path-scoping refusal arrives as `PATH_NOT_CONTAINED` because this lane inherits the
refusal-reason envelope — a caller learns *why*, not just that it failed.

17 engine tests against real temporary repositories, 14 extension tests. Extension 794/794.
