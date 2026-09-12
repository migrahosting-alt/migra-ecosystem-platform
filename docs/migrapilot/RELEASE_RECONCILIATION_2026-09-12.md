# MigraPilot release reconciliation — local vs deployed

_Measured 2026-09-12. Every SHA below was read from the running artifact or from git, not recalled._

## 1. Surface inventory

| Surface | Repo / branch | Commit | Release | Host | Supervisor | URL |
| --- | --- | --- | --- | --- | --- | --- |
| **Public consumer** | migra-ecosystem-platform | `0f494d27` | `chat-platform-rc-0908` (buildId `AV5gDWNOlGsz3wDMI-NIf`, built 2026-09-08T14:44:37Z) | `migrapilot-app-core` 10.10.0.13 (VM111) | systemd `migrapilot-consumer.service` (active/enabled) | https://chat.migrateck.com |
| **Public Brain** | same | `0f494d27` | `chat-platform-rc-0908` (buildId `sha256:d9d9c1e3…`, built 2026-09-08T14:38:37Z) | same host | systemd `migrapilot-brain.service` (active/enabled) | internal |
| **Local consumer** | same, branch `feature/migrapilot-conversation-first-modernization` | `3c204aa8` | unstamped — `/api/version` reports `stamped:false` | this workstation | `next dev` | http://127.0.0.1:3000 |
| **Local Brain** | same | `3c204aa8` **source** | see note below | this workstation | `node --import tsx src/server.ts` | http://127.0.0.1:3988 |
| **Staging consumer** | — | — | — | **does not exist** | — | — |

**The local Brain's `dist/RELEASE.json` says `0f494d27` / `rc-0908` — the same as production — and that is STALE.** It is a leftover from the last release build; the process actually runs TypeScript from source at HEAD. Owner acceptance therefore ran against **source `3c204aa8`**, not against any stamped artifact. Anyone reading that file to answer "what did we test?" would get the wrong answer with full confidence.

**Staging**: `deploy-targets.sh` defines a `staging` target (`DEPLOY_HOST=migrapilot-staging-core`), but the name **does not resolve** — no such host. `/opt/migrapilot/staging` on the production host is a scratch directory (tarballs, probe scripts); its `current` symlink is empty. `brain-canary` (`bc99059`) and `consumer-canary` (`87658f5`) exist on the production host and are a smoke lane, not a staging environment.

## 2. Drift

Deployed `0f494d27` is a clean **ancestor** of local `3c204aa8` — linear, no divergence.

| Area | Commits deployed → local |
| --- | --- |
| `apps/brain-service` | **65** |
| `apps/migrapilot-consumer` | **11** |
| `packages/shared-types` | **3** |

The branch is **1168 commits ahead of `core/main`** and has **no upstream** — it does not exist on any remote. All of this work lives on one machine.

### Why local shows the newer capability menu and production does not

Production serves `0f494d27`, built 2026-09-08T14:44Z. The capability-driven action hub landed in commits that are **descendants** of it and were never deployed:

- `abcf7659` the action hub is capability-driven, not a list of buttons
- `9fb6e3df` Email joins the hub as registered-but-unavailable
- `0bf4efdd` Search joins the hub
- `d2889ae7` a remedy is a token, not a sentence to be parsed
- `2624afc3` the consumer's connection routes · `0e45b400` Connect control · `5c2f2613` disconnect
- `fde2defa` one file policy · `270813f2` one email executor · `73e2ae5e` one workbook reader

Not a config difference and not a cache. The deployed artifact predates the feature.

## 3. Uncommitted work at risk

Only three MigraPilot files are uncommitted, and **none are from the Gmail/chat work**:

- `apps/brain-service/src/engine/engineer/engineerRoutes.ts`
- `apps/brain-service/src/engine/engineer/engineerRuntime.ts`
- `apps/brain-service/scripts/review-source-bundle.mjs`

They belong to another in-flight session (they carry the `unifiedAgent` test failure that reproduces with this work stashed). Also uncommitted: `.claude/hooks/block-dangerous.sh`, owned by that session.

**No feature from this acceptance work exists only as an uncommitted edit.** The risk is that the *commits are unpushed*, not that changes are unsaved.

## 4. Release state of each item

| Work | State |
| --- | --- |
| Capability-owned Gmail rendering (`90485cb4`) | **COMMITTED** — not deployed |
| Attachment listing determinism (`90485cb4`, `be1cc014`) | **COMMITTED** — not deployed |
| Exact spreadsheet value rendering (`90485cb4` hybrid payload) | **COMMITTED** — not deployed |
| Thread-summary / empty-heading cleanup (`8db74e36`) | **COMMITTED** — not deployed |
| Grounding gate for `/api/ai/chat` (`2119c71f`, `7e60fd33`, `3926a9c4`, `7251112a`, `55993942`) | **COMMITTED** — not deployed |
| Provider-match → attachment bridge (`75325660`, `9fc42792`) | **COMMITTED** — not deployed |
| Attachment/capability menu (`abcf7659` + 10 others) | **COMMITTED** — not deployed |
| Consumer authentication | **LOCAL CONFIG ONLY** — `.env.local` (gitignored, correctly) plus one OAuth client on the live IdP. No code change; production carries its own config. |
| Six-step Gmail UI acceptance | **NOT PERFORMED** — owner test |

## 5. Release candidate

- **RC SHA**: `3c204aa8b790984b59e45d2b5e3c80d6bc06e9ec`
- Recorded, **not tagged** — tagging is a release action not yet authorised.
- The tree is clean for consumer and shared-types; the brain has three foreign files that must be resolved or stashed before a brain build, because `deploy-brain.sh` refuses a dirty tree.

## 6. Rollback

Production keeps release directories and swaps a symlink, so rollback is a symlink swap plus a service restart, run as root on the host:

| Service | Current | Rollback target |
| --- | --- | --- |
| consumer | `chat-platform-rc-0908` | `chat-platform-rc-0907b` |
| brain-service | `chat-platform-rc-0908` | `chat-platform-rc-0907b` (then `rc-0907`) |

Point `/opt/migrapilot/consumer/current` back at `releases/chat-platform-rc-0907b` and restart
`migrapilot-consumer.service`; the same shape for `brain-service`. Both previous releases are
present on the host, so rollback needs no rebuild and no network.

## 7. Proposed promotion path — NOT executed

1. Resolve the three foreign brain files (their owner commits or stashes them).
2. **Create a staging target.** `migrapilot-staging-core` is referenced by the deploy scripts and does not exist. Production must not be the first place this build runs.
3. Build and deploy the RC to staging via `deploy-brain.sh --target staging` and the consumer equivalent.
4. Owner verifies on staging: sign-in, chat, the Gmail six-step flow, attachments, capability menu, files, history.
5. Only then production, recording source SHA, artifact hash, timestamp, target host, previous SHA and the rollback command.
6. Verify `https://chat.migrateck.com/api/version` reports the new commit.

**Nothing was deployed. Production still serves `0f494d27`.**
