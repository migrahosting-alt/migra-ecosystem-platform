# Brain deployed to staging — results

## Release gate

| requirement | result |
| --- | --- |
| typecheck clean | ✅ `tsc -b` clean |
| Brain tests | ✅ **3238 / 3238, 0 failures** |
| pre-existing unrelated failures | **none** — see note below |
| no new skipped tests | ✅ `# skipped 0`, `# todo 0`; `.skip(` introduced by this work: 0 |
| release artifact reproducible | ✅ 5 workspace deps staged from this build and verified in both directions |
| source SHA | `f9ad3c0c6d5c9a22cf0572d0e12486769758d517` |
| artifact SHA | `sha256:d848483a6ae34e93ac6952710361b04bf34a3999` |

🚨 **The `unifiedAgent` failure was also a working-tree artifact.** It had been carried as a
"pre-existing unrelated failure", but at *committed* HEAD in a clean worktree the suite is
entirely green. It only failed in the working tree, where the engineer lane's uncommitted
changes are present. So there is no pre-existing failure to except: the gate is clean.

## Two blockers found, both real

**1. The partial commit** — diagnosed in [`README.md`](./README.md). Repaired by removing the
test my own lane committed without its implementation.

**2. A deleted test kept running.** After removing the source, the full gate reported the
*identical* 3241 tests with the *identical* 3 failures. `npm test` is
`tsc -b && node --test dist/test/**/*.test.js` — it runs the COMPILED tree, and `tsc` never
removes an output whose input disappeared. The release gate was enforcing a file that was no
longer in the repository.

`scripts/prune-orphaned-dist.mjs` now runs after the build and removes only outputs whose
source is absent. First run: **179 orphaned files**, nearly all from the `engine/`
reorganisation that moved 52 modules into 10 domains and left the old output behind.

**3. The boot test could not start.** `226/NAMESPACE` —
`ReadWritePaths=/var/log/migrapilot` did not exist on the staging host. The deploy aborted
**before the cutover**, which is the boot test doing exactly its job. Directory created to
match production; no script change.

## Deployment chain

```
committed source     f9ad3c0c
artifact             dist + package.json, buildId sha256:d848483a6ae34e93ac6952710361b04bf34a3999
schema delta         built 28 / staging 28 — no migrations pending, rollback restores code AND schema
rollback validated   staging-3c204aa8 — complete and servable, checked BEFORE anything moved
hash verification    5 workspace packages staged from this build:
                       agent-defs ccbad90e77cdd4f3…  pilot-client 363d1be3e85c6673…
                       protocol   034e43bc9628d3a0…  shared-types 5797665fa38bb30d…
                       workspace-tools
                     ✓ staged bytes match the build   ✓ rollback release bytes unchanged
transfer             tar → ssh migrapilot-staging-core
release directory    /opt/migrapilot-staging/brain-service/releases/staging-f9ad3c0c
boot test            port 3987, as a transient COPY OF THE REAL UNIT → HTTP 200
identity check       commit, release and buildId all match
symlink              current -> staging-f9ad3c0c
restart              migrapilot-staging-brain.service → active
runtime verification reports commit f9ad3c0c / release staging-f9ad3c0c
EXIT=0
```

No manual side-path. The consumer was redeployed the same way twice more
(`staging-f18db0fe` → `staging-10796d03`).

## P0 validation 5 — LOCALITY, against the deployed Brain

Execution locality from evidence: bytes on disk against advertised parameters, and VRAM
residency *during* generation.

| class | model | disk | resident | VRAM | **actual** | declared |
| --- | --- | --- | --- | --- | --- | --- |
| fast | qwen2.5-coder:1.5b | 986 MB | yes | 2.1 GB | ON-DEVICE | local / 0 |
| balanced | llama3.1:8b | 4.9 GB | yes | 13.6 GB | ON-DEVICE | local / 0 |
| automatic | llama3.1:8b | 4.9 GB | yes | 13.6 GB | ON-DEVICE | local / 0 |
| coding | qwen2.5-coder:14b | 8.99 GB | yes | 15.3 GB | ON-DEVICE | local / 0 |
| reasoning | qwen3:8b | 5.2 GB | yes | 11.5 GB | ON-DEVICE | local / 0 |
| **deep** | **deepseek-r1:32b** | **18.5 GB** | **yes** | **21.4 GB** | **ON-DEVICE** | local / 0 |
| **premium** | **deepseek-r1:32b** | 18.5 GB | yes | 21.4 GB | **ON-DEVICE** | local / 0 |
| **explicit `gpt-oss:120b-cloud`** | **llama3.1:8b** | 4.9 GB | yes | 13.6 GB | **ON-DEVICE** | local / 0 |

Catalog on the deployed Brain:

```
catalog count:                    15      (was 16)
cloud-tagged models eligible:     NONE
models labelled hosting=remote:   none
models labelled hosting=on-device: 15
deep-tier candidates:             deepseek-r1:32b (on-device), qwen3-coder:30b (on-device)
```

Every requirement met:

- **deep no longer selects cloud** — `deepseek-r1:32b`, 21.4 GB resident while generating.
- **`gpt-oss:120b-cloud` cannot masquerade as local** — it is not selectable at all. Naming it
  explicitly falls through to `llama3.1:8b`, because it is not in the catalog to be found.
- **any remote route would be labelled `hosting: remote`** — none is present; with
  `MIGRAPILOT_ALLOW_REMOTE_MODELS` it appears labelled, never relabelled local.
- **declared locality matches actual** — all eight declared local, all eight verifiably
  on-device.
- **declared cost class matches routing policy** — cost 0 is now true, because nothing leaves
  the machine.

Before the deploy, the same harness against the same Brain host showed `deep` and `premium`
selecting a **384-byte manifest with zero VRAM** that still generated. That is the defect, and
it is gone.

## P0 validation 6 — PROVIDER HEALTH, against the deployed artifact

A second instance of the **deployed release** started on a spare port with no inference
endpoint. The running staging Brain was never touched and is still active on the same release.

```
artifact under test: staging-f9ad3c0c / sha256:d848483a6ae34e93…

  overall status     : error
  inferenceProviders : unavailable
  local    reachable=False kind=stub  deterministic stub — no inference endpoint configured (set MIGRAPILOT_…)
  cheap    reachable=False kind=stub  …
  default  reachable=False kind=stub  …
  premium  reachable=False kind=stub  …
```

No green health from stub presence. And on the *running* Brain, every provider line now carries
`kind: "live"` — the distinction is visible in production traffic, not only in the failure case.

## Item 7 — typed image-generation error, end to end

```
prompt   "Make me a picture of a blue circle."
before   { error: "brain_error",                        message: "Image generation is not configured on this server." }
after    { error: "image_generation_not_configured",    message: "Image generation is not configured on this server." }
```

🚨 **This needed a second fix, found only by running it.** Image generation streams its refusal
as an SSE `error` **frame**, not as an HTTP failure, so the mapping first added to `refusalOr`
(the buffered path) never saw it. Both halves were deployed and the browser still received
`brain_error`. The frame handler now reads the code — never the message text. (`10796d03`)

## Item 8 — capability regressions, deployed Brain + consumer

| asked | answered |
| --- | --- |
| overview | "Here is where each of those actually stands: • Reading documents you attach — yes…" |
| search the web | **"Searching the web — no. Web search is not set up yet."** |
| read a PDF | **"Reading documents you attach — yes. PDF, CSV, JSON, Markdown, plain text, code and .xlsx…"** |
| see an image | **"Understanding images — not right now. …no vision model has been approved for use."** |
| check my email | **"Reading your email — no. Email is not set up yet."** |
| open a local file | **"Reading your uploaded files — yes. …Local paths on your own computer are not readable."** |
| write and run code | **"Running code — no. …Explaining, writing and reviewing it is."** |
| remember yesterday | **"Remembering earlier conversations — yes. …including after a restart."** |
| transcribe audio | **"Transcribing audio — no. …Set MIGRAPILOT_SPEECH_RUNTIME_URL…"** |

No model-regenerated contradictions. Vision reads as governance-blocked rather than absent;
web search and email use the engine's own sentences.

## Item 9 — production isolation

| | before | after |
| --- | --- | --- |
| release | `0f494d27` / `chat-platform-rc-0908` | identical |
| consumer symlink | `releases/chat-platform-rc-0908` | identical |
| brain symlink | `releases/chat-platform-rc-0908` | identical |
| consumer started | Fri 2026-09-11 06:31:26 UTC | **identical** |
| brain started | Fri 2026-09-11 06:31:26 UTC | **identical** |
| `migrapilot_brain` | 200 MB | 200 MB |

Checked at 2026-09-12 22:32 UTC — over 40 hours of unbroken production uptime across every
deploy in this phase.

## Retention

`--keep=1` applied after the final deploy: 759 MiB freed, 5.2 GB free. Consumer keeps
`staging-10796d03` (active), `staging-f18db0fe` (rollback), `staging-d830e594` (spare); Brain
keeps `staging-f9ad3c0c` (active), `staging-3c204aa8` (rollback),
`chat-platform-rc-0908` (spare).
