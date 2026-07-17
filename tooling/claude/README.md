# Claude guards — durable bootstrap

The MigraPilot dev environment relies on a `PreToolUse` guard
(`.claude/hooks/block-dangerous.sh`) that blocks force/delete/mirror/non-origin
pushes and other dangerous commands. Both that hook and `.claude/settings.json`
live under `.claude/`, which this repo **ignores by default** (`.gitignore` line
`*`). Ignored local files silently disappear on checkout, clone, worktree
recreation, or environment reset — so the guard cannot be trusted to persist on
its own.

## The durable pattern

| Path | Role | Tracked? |
|---|---|---|
| `tooling/claude/block-dangerous.sh` | **canonical** guard (source of truth) | yes (force-added) |
| `scripts/dev/install-claude-guards.sh` | installer + verifier | yes |
| `scripts/dev/test-claude-guards.sh` | fail-closed test matrix | yes |
| `.claude/hooks/block-dangerous.sh` | installed/generated copy | no (ignored, local) |
| `.claude/settings.json` | local permissions + hook registration | no (ignored, local) |

The installer copies the canonical hook into `.claude/hooks/`, sets the exec
bit, verifies the checksum matches the canonical source, confirms the
`PreToolUse` registration references it, runs the full allow/deny policy matrix,
and **fails closed** (non-zero exit) if anything is missing, tampered,
unregistered, or regressed.

## Run this after any environment change

After a fresh clone, branch checkout, worktree recreation, or environment reset:

```bash
npm run guards:install     # copy canonical → .claude/hooks/ + verify
npm run guards:verify      # verify only (no copy) — fast health check
npm run guards:test        # fail-closed matrix (also runs in CI)
```

CI runs `guards:test` and an install+verify on every PR
(`.github/workflows/claude-guards.yml`).

## Policy (enforced by the guard, tested by the matrix)

- **allow:** `git push -u origin <branch>`, ordinary non-git commands
- **block:** `git push --force` / `-f`, `--delete` / `:refspec`, `--mirror`,
  pushes to any non-`origin` remote (e.g. the on-host `core` remote),
  `rm -rf`, `sudo`, `git reset --hard`, `git clean`, `chmod 777`, `chown`

> If `npm run guards:verify` fails, treat the guard as ABSENT — do not run
> mutating git commands until `npm run guards:install` passes.
