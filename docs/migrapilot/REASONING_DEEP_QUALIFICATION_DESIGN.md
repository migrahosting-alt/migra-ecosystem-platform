# `reasoning.deep` — qualification & signing path

**Design only. No approval issued. No key minted. No UI changed. Production untouched.**

Everything below was read from source or measured against the running services on 2026-09-13.

---

## 1. The governance chain, boundary by boundary

```
Migra Logic  (UI)
  │  ModelFamilySelector.tsx → useModelFamilies → GET /api/model-families
  ▼
consumer route  src/app/api/model-families/route.ts
  │  operations.ts:852 → GET /api/ai/model-families?surface=migrapilot-consumer
  ▼
Brain route  aiRoutes.ts:349
  │  familiesForSurface(surface) → requirements.governedCapability
  ▼
CATALOG  packages/shared-types/src/modelFamilies.ts:134
  │  'migra-logic'.requirements.governedCapability = 'reasoning.deep'
  ▼
governance lookup  aiRoutes.ts:394 → approvedByCapability()
  │  visionGate.ts:107 → approvedForCapability()
  ▼
PERSISTENCE  modelQualificationRepo.ts:172
  │  SELECT * FROM model_qualification_decisions
  │  WHERE capability=$1 AND state='approved' AND revoked_at IS NULL
  ▼
resolver  modelFamilyResolver.ts → resolveFamiliesForSurface()
  │  gates: governedDecision · approvedForTaskClass · executable · routerAccepts
  ▼
projection  aiRoutes.ts:436 → { available, governed, unavailableReason, basis }
  ▼
UI  "Migra Logic isn't available yet — no model has been approved for it."
```

The **write** side, which is the path an approval would travel:

```
operator  src/cli/qualifyModel.ts
  │  MIGRAAUTH_TOKEN → GET /v1/admin/me → approver identity + permissions
  │  requires permission `platform.models.qualify`
  │  signs with MIGRAPILOT_QUALIFICATION_SIGNING_KEY_V<n>  (HMAC-SHA256)
  ▼
POST /api/ai/model-qualification/evidence   → evidence run row
POST /api/ai/model-qualification/approve    → decision row
  │  qualificationRoutes.ts:138 requireAssertion()
  │  internalAuth/assertion.ts verifyAssertion()
  │  nonce consumed in the DB (consumeNonce) — survives restart
  ▼
model_qualification_decisions
```

### Six boundaries that matter

| # | boundary | who owns it |
| --- | --- | --- |
| 1 | catalog → `governedCapability` | `packages/shared-types` — a shared contract, versioned by `MIGRA_MODEL_CATALOG_REVISION` |
| 2 | Brain → governance table | SQL; approval is a **row**, not config |
| 3 | assertion verification | `internalAuth/` — keys, service policy, nonce |
| 4 | approver identity | **MigraAuth**, never the CLI's argument |
| 5 | resolver gates | four independent gates, any one can refuse |
| 6 | consumer projection | pass-through; the UI authors no verdict |

**Two gates, not one.** `migra-forge` is available today because it declares **no**
`governedCapability` and clears `approvedForTaskClass('typed-implementation')` against
`MEASURED_GRANTS`. `migra-logic` declares one and must additionally clear the governance table.
Both work; they are different gates. *(Live basis: `grant:typed-implementation` vs
`reasoning.deep`.)*

---

## 2. The staging signing gap — exactly what is missing

Measured: `POST /api/ai/model-qualification/approve` → **503 `signing_not_configured`**.

Source of that refusal, `qualificationRoutes.ts:142`:

```ts
if (!deps.internalAuth.enabled) {  // enabled = keys.size > 0
  await deps.audit('qualification.denied', { reason: 'signing_not_configured', path });
  res.code(503).send({ error: 'signing_not_configured', … });
```

| component | staging | verdict |
| --- | --- | --- |
| **signing key** | no `MIGRAPILOT_QUALIFICATION_SIGNING_KEY_V*` in `/etc/migrapilot-staging/brain.env` | ❌ **the only blocker** |
| signer service | `src/cli/qualifyModel.ts` ships in the repo | ✅ exists |
| key registration | none needed — discovered by env-var name, `loadSigningKeys()` | ✅ by design |
| trust root | MigraAuth for the human; HMAC key for the service | ✅ exists |
| service policy | `migrapilot-qualification-cli` → `platform.models.qualify` | ✅ compiled in |
| approval persistence | `model_qualification_decisions`, schema 28/28 on staging | ✅ present |
| nonce persistence | `consumeNonce` in a DB transaction, outlives restart | ✅ present |
| verification path | `verifyAssertion` — key, service, action, method, path, body digest, TTL, nonce | ✅ present |

**It is one environment variable, plus an operator able to obtain a MigraAuth token holding
`platform.models.qualify`.** Nothing is missing from the code.

### Minimal safe staging-only configuration (not applied)

1. Generate 32 bytes of entropy **on the staging host**, never on a workstation, never in a repo:
   `openssl rand -hex 32`.
2. Deliver it as `MIGRAPILOT_QUALIFICATION_SIGNING_KEY_V1` to
   `/etc/migrapilot-staging/brain.env` (already `0600 root:root`), or preferably via the
   stronger mechanism in §9.
3. Restart `migrapilot-staging-brain.service`; `governanceState` flips `unsigned` → `ready`.
4. The operator exports `MIGRAAUTH_TOKEN` in their own shell — the CLI refuses it as an argument.

🚨 **Staging's key must be distinct from production's and must never be copied between them.**
See §7.

---

## 3. The evidence contract

**There is already a proven shape**, `src/eval/chatGeneral/` — `reasoning.deep` should extend it,
not invent a second one. Its `EvidencePackage` carries capability, `suiteRevision`,
`thresholdRevision`, candidate `{model, digest, runtime, hardware}`, harness parameters,
timestamps, per-case outcomes with replication counts, verdict, full failure transcripts, and
**negative controls reported separately because "these validate the run itself, not the
candidate."**

Its threshold design is the part to copy exactly:

- an **overall floor** (0.80) *plus* a **per-dimension floor**, because "an average is exactly
  the statistic that hides a hole";
- higher floors for the failures that are invisible to a casual reader — hallucination
  resistance, refusal/uncertainty, structured output;
- `negative_control` demands **1.0**, alone among dimensions: a single failure means the headline
  score may have been earned by a degenerate strategy, so it **invalidates the run** rather than
  costing points.

### Proposed dimensions for `reasoning.deep`

`reasoning.deep` is defined in the capability vocabulary as *"Multi-step analysis and planning,
beyond a single-shot answer."* The suite must test that, not general fluency.

| dimension | what it establishes | floor |
| --- | --- | --- |
| `multi_step_arithmetic` | state carried across ≥3 dependent steps | 0.80 |
| `constraint_satisfaction` | honours all constraints, not the convenient subset | 0.75 |
| `plan_ordering` | dependency-correct ordering; detects cycles | 0.75 |
| `trap_resistance` | resists the plausible single-shot answer (bat-and-ball class) | 0.80 |
| `arithmetic_fidelity` | the reasoning is right **and** the final number is right | 0.90 |
| `hallucination_resistance` | invents no premises | 0.90 |
| `refusal_uncertainty` | says it cannot know, rather than inventing | 0.90 |
| `structured_output` | strict JSON on demand — the tool/capability contract | 0.85 |
| `long_chain_stability` | does not lose the thread at depth | 0.66 |
| `negative_control` | degenerate strategies fail | **1.00** |
| overall | | 0.80 |

### 🚨 Three contract requirements my own harness proved are necessary

1. **`done_reason` must be recorded, and truncation must never score as a wrong answer.** My
   first audit capped `num_predict` at 900; reasoning models spent it inside `<think>` and never
   reached the answer, and three items were scored FAIL. *A qualification harness that scores its
   own truncation as a model failure would disqualify a good model.* The corrected run has
   `qwen3:8b` answering that identical item correctly.
2. **Score the visible answer, not the `<think>` block.** Crediting a model for reaching the
   answer privately and then discarding it measures the wrong thing.
3. **Record cold-load vs steady-state latency separately.** First-token time on a cold model
   includes weight loading and is not the latency a user experiences.

### Facts the evidence must carry beyond scores

model identity · **exact digest** · provider · **hosting/locality classification** (a provider
label is not a locality guarantee — established rule) · license + provenance · context size ·
VRAM footprint measured during generation · latency (cold and warm) · failure behaviour ·
structured-output behaviour · safety/refusal behaviour · MigraPilot tool-contract compatibility ·
hardware and runtime identity of the machine that ran it.

**"The model answered the reasoning questions" is not qualification.** The vision precedent is in
the capability vocabulary's own comment: vision was split into `general` and `object_counting`
*after a model that described images perfectly miscounted what was in them*.

---

## 4. Candidate audit

Evidence collection only. **Nothing here approves anything.**

All four candidates are installed, local, and `Q4_K_M`. Digests and sizes read from the Ollama
catalog on 2026-09-13:

| model | size (bytes) | params | digest (first 24) |
| --- | ---: | ---: | --- |
| `qwen3:8b` | 5,225,388,164 | 8.2B | `500a1f067a9f782620b40bee` |
| `qwen3:14b` | 9,276,198,565 | 14.8B | `bdbd181c33f2ed1b31c97299` |
| `qwen3-coder:30b` | 18,556,700,761 | 30.5B | `06c1097efce0431c2045fe7b` |
| `deepseek-r1:32b` | 19,851,337,809 | 32.8B | `edba8017331d15236e57480e` |

**Locality: all four are on-device.** Each is orders of magnitude larger than 1 MB, which is the
existing test that separates real weights from a cloud manifest (`isRemotelyHosted`). No
`-cloud`-tagged model is eligible on this deployment.

Controlled-prompt results are in `evidence/reasoning-deep-audit-2026-09-13/`. Read them as a
**preliminary probe, not a qualification run**: five items, one replication each, on a suite that
has not been revision-pinned. The real suite requires replication, negative controls, and a
`thresholdRevision`.

Known from prior measurement: `deepseek-r1:32b` is the model the router already selects for the
deep tier (`reason: selected deepseek-r1:32b [tier=deep (wanted deep), reasoning-capable]`), at
**21.4 GB resident** on a 24 GB RTX 3090 — that fits, with little headroom for a second resident
model.

---

## 5. Approval semantics

The existing `QualificationDecision` already binds most of what an approval must mean:

| required binding | today | gap |
| --- | --- | --- |
| capability | `capability` | — |
| model identity | `modelId` + `modelVersion` | — |
| **exact digest** | `modelDigest`, `sha256:` + 64 hex, pattern-enforced | — |
| evidence run | `evidenceRunId`, FK-checked: must exist, match model+capability, and have **passed** | — |
| signer identity | `approverUserId` (human, from MigraAuth) + `callingService` + `requestId` | — |
| timestamp | `decidedAt` | — |
| **policy version** | ✗ | 🚨 **the one real gap** |

The evidence run records `suite`, and the chat.general package carries `suiteRevision` and
`thresholdRevision` — but **the decision row does not bind them**. So an approval cannot today
answer *"which version of the bar did this clear?"* without joining through evidence and trusting
that the suite has not been edited since.

**Recommendation:** add `suite_revision` and `threshold_revision` to the decision row, copied
from the evidence package at approval time. An approval is a claim about a model *against a
stated bar*, and a bar that can move invisibly makes the claim unfalsifiable.

The approve route already refuses evidence that is missing, mismatched, failed, or digest-less —
*"an approval pointing at nothing, at another model, or at a failed run is not a governed
decision — it is the same hand-wave the JSON file allowed, wearing a foreign key."*

**A model tag alone is never sufficient, and the code already enforces that.**

---

## 6. Revocation and invalidation

`revokeApproval()` exists and is conditional on the approval still being live — *"two concurrent
revocations must not both report success."* Explicit revocation is sound.

**What is missing is automatic invalidation.** These should invalidate an approval, and today
none of them does so on its own:

| trigger | today | proposed |
| --- | --- | --- |
| **model digest changes** | 🚨 not detected | compare approved digest to the live catalog digest at resolve time; on mismatch treat as **not approved** and surface `digest_drift` |
| evidence contract version changes | not detected | approval carries `suiteRevision`; a newer revision marks prior approvals `requalification_required` |
| failed requalification | manual | a failed run against an approved pair auto-revokes |
| locality classification changes | not detected | on-device → remote is a **material** change; re-approval required |
| provider changes | not detected | provider is part of the evidence; a change invalidates |
| security / licensing issue | manual | manual is correct here; humans should own this |

🚨 **Digest drift is the important one.** The decision stores a digest and
`approvedByCapability()` returns it, but **nothing compares it to the running model.** A tag can
be repointed at different weights — which is precisely why the digest is captured — so today an
approval could authorise bytes nobody evaluated. The check is cheap: the catalog already exposes
a digest per model.

---

## 7. Staging vs production trust

**Recommendation: environment-specific authorisation, shared immutable evidence.**

| question | answer |
| --- | --- |
| different signing keys? | **Yes, mandatory.** Key ids are already versioned per environment; sharing one would make a staging compromise a production compromise. |
| can staging approvals be promoted? | **No.** A decision row is environment-local. Production must re-sign. |
| must production re-sign the exact digest? | **Yes** — same model, same digest, production's own key, production's own approver. |
| may evidence be shared? | **Yes**, and it should be: an evidence run is an immutable measurement of a model on stated hardware. It is a *fact*; the approval is a *decision*. |

That split is already latent in the schema — evidence runs and decisions are separate tables
joined by `evidenceRunId`. The design makes it explicit: **facts travel, authority does not.**

One caveat to record with any shared evidence: it names the `hardware` it ran on. Evidence
measured on the RTX 3090 does not establish behaviour on different production hardware, and
VRAM-footprint and latency dimensions in particular must be re-measured rather than inherited.

---

## 8. UI behaviour after approval (defined, not implemented)

- **Becomes selectable** when the governance table holds a live, non-revoked `reasoning.deep`
  approval whose digest matches the running model, *and* the resolver's other gates pass
  (`executable` — not `-cloud`; `routerAccepts` under enforcement). Availability stays **computed
  live**, never cached into the catalog.
- **On revocation** it returns to unavailable within one `/api/model-families` fetch, and any
  stored per-user family preference must fall back to automatic routing rather than erroring. The
  selector already keeps unavailable families **listed and unselectable with a reason**, which is
  the right behaviour — *"hiding a family would look like the capability never existed."*
- **Unavailable reason** should distinguish the causes rather than collapse them, exactly as the
  document-read work did: `no approved model for reasoning.deep` (none) vs
  `the approved model for reasoning.deep is not installed on this host` vs `digest_drift — the
  approved model's weights have changed and it must be requalified`.
- **🚨 May automatic routing use an approved model before the family is exposed?**
  **It already can, and this must be decided deliberately.** Automatic routing is governed by
  `enforceQual` + `routerAccepts`, a *different* gate from `governedCapability`. Under
  `permissive` mode the router selects `deepseek-r1:32b` for deep-tier work today — with no
  `reasoning.deep` approval anywhere. So the product already *runs* deep reasoning while
  correctly declining to *offer* it as a named family.

  That is defensible — the family is a **product promise**, routing is an **implementation
  detail** — but it should be an explicit owner ruling rather than an artifact of two gates
  having different strictness.

---

## 9. Security

**The keys must not sit casually in an application env file if something stronger exists.** The
current pattern is `/etc/migrapilot-staging/*.env`, mode `0600`, root-owned, loaded by systemd
`EnvironmentFile=`. That is decent and it is what the code expects
(*"KEYS COME FROM THE ENVIRONMENT ONLY. Never a literal, never a default, never a file this
repository contains"*).

**Stronger, and already available on these hosts:** systemd credentials. `/run/credentials` is in
use on the staging host. `LoadCredentialEncrypted=` stores the secret encrypted at rest, bound to
the host, and exposes it to *only* that unit under `/run/credentials/<unit>/` — rather than to
every process that can read the env file. Rotation stays additive because the key is discovered
by name (`..._V2` alongside `..._V1`).

**Recommended:**

- generate on the host; never on a workstation, never through a clipboard, never in a repo;
- `LoadCredentialEncrypted=` in preference to a plaintext `EnvironmentFile`, with a small shim
  that reads the credential file into the expected env var, or a loader change to read
  `$CREDENTIALS_DIRECTORY` directly;
- distinct key per environment, distinct key per calling service — the config comment already
  argues this: *"when one is compromised, the blast radius should be one caller and the
  revocation should be one key"*;
- **no secrets in evidence.** Evidence packages carry model, digest, hardware, runtime and
  transcripts. Transcripts are model output and must be reviewed before storage — a prompt that
  elicits configuration would otherwise persist it into an evidence record.
- the existing audit trail already records `qualification.denied` with a reason; approvals should
  be equally auditable.

---

## 10. Implementation plan

| # | step | owner decision needed |
| --- | --- | --- |
| 1 | Add `suite_revision` + `threshold_revision` to the decision row (§5) | schema migration |
| 2 | Build `src/eval/reasoningDeep/` — `cases.ts`, `threshold.ts`, `run.ts`, mirroring chat.general, with the three harness requirements from §3 | thresholds are a policy choice |
| 3 | Enforce digest drift at resolve time (§6) | fail-closed vs warn |
| 4 | Configure staging signing (§2) via §9's mechanism | **key custody** |
| 5 | Run the suite against the four candidates; store evidence | — |
| 6 | Owner reviews evidence and decides approval | **the actual governance decision** |
| 7 | Approve on staging with staging's key; validate Migra Logic end to end | — |
| 8 | Re-run evidence on production hardware; re-sign with production's key | **separate decision** |

### Owner decisions required

1. **Should `reasoning.deep` be offered at all?** Nothing here argues it should. `deepseek-r1:32b`
   is 21.4 GB resident on a 24 GB card and took ~245 s for one deep turn through the product — a
   real cost to weigh against the promise.
2. **Thresholds** — the numbers in §3 are proposals.
3. **Key custody** — who generates, who holds, rotation cadence, and `EnvironmentFile` vs
   `LoadCredentialEncrypted`.
4. **Digest drift: fail-closed or warn?** I recommend fail-closed, consistent with everything
   else in this system.
5. **May automatic routing use deep models before the family is exposed?** (§8) — currently yes,
   by accident of two gates differing.
6. **Is shared evidence across environments acceptable**, with authority staying environment-local?

---

**`reasoning.deep` QUALIFICATION PATH DESIGNED — NO APPROVAL ISSUED**
