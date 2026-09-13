# Migra Logic exposure — audit only — 2026-09-13

**Nothing was changed. Migra Logic was not made selectable. No approval mechanism was bypassed.**

The question: why does the UI say Migra Logic is unavailable while the backend demonstrably
runs `deepseek-r1:32b`?

---

## Answer

**Migra Logic is gated on a governed capability, `reasoning.deep`, which has no approved model
in the qualification table. The router's ability to run the model is a different fact from
governance's permission to offer it, and the product is correctly reporting the second.**

The cause is **not** the same on both hosts, and that distinction is the useful part:

| | staging | production |
| --- | --- | --- |
| `reasoning.deep` approvals | **none** | **none** |
| can an approval be recorded? | **no** — `signing_not_configured` | **yes** — proven below |
| therefore | approvals are *impossible* here | nobody has *run* the qualification |

---

## How each candidate cause was tested

| candidate | verdict | evidence |
| --- | --- | --- |
| **governance signature / state** | **ROOT CAUSE (staging)** | `POST /api/ai/model-qualification/approve` → **HTTP 503** `{"error":"signing_not_configured"}`. No key, so a governed mutation is *impossible* rather than unchecked. |
| **model approval registry** | **ROOT CAUSE (production)** | `GET /api/ai/model-qualification/reasoning.deep` → `{"approved":[]}` on both hosts. On production this is not blocked by signing — see below — so it is simply an approval nobody has made. |
| **family → model mapping** | **not the cause** | The mapping is sound. `migra-logic` requires `capabilities: ['chat','reasoning']`, `minTier: 'deep'`; `deepseek-r1:32b` is deep-tier and reasoning-capable, and the router selected it in owner validation (19,851,337,809 bytes on disk, 32.8B params, `reason: selected deepseek-r1:32b [tier=deep (wanted deep), reasoning-capable]`). |
| **consumer capability projection** | **not the cause** | The consumer renders exactly what the Brain returns. The reason string in `ModelFamilySelector` is `unavailableReason` from `/api/ai/model-families`, not text the UI composes. |
| **stale deployment / config** | **not the cause** | Every reading above is from the **running** service on each host, not from source or from a cached build. |

### Why production proves signing works there

```
GET /api/ai/model-qualification/vision.general   (production)
  approved: [{ modelId: "qwen2.5vl:7b",
               modelDigest: "sha256:5ced39dfa4bac325dc183dd1e4febaa1c46b3ea28bce48896c8e69c1e79611cc",
               state: "approved", evidenceRunId: "b437…" }]
```

A complete governed decision — evidence run, approved state, and a **digest** pinning exact
bytes rather than a tag. So on production the chain works end to end and `reasoning.deep` is
unapproved because the qualification was never run for it, not because it could not be.

`migra-vision` is correspondingly **available on production** and unavailable on staging, which
is the same mechanism observed from the other side.

---

## Why `migra-forge` is available and `migra-logic` is not

This is the structural difference, and it is in the catalog rather than in any runtime state:

```ts
'migra-logic':  requirements: { …, governedCapability: 'reasoning.deep',
                                taskClasses: ['patch-planning','dependency-analysis'] }

'migra-forge':  requirements: { …, /* NO governedCapability */
                                taskClasses: ['typed-implementation', …] }
```

`migra-forge` declares **no governed capability**, so it resolves through
`approvedForTaskClass('typed-implementation')` against `MEASURED_GRANTS` — a table of
*measured* grants that does hold that entry. Live basis: `grant:typed-implementation`,
backend `qwen3-coder:30b`.

`migra-logic` declares one, so it must additionally pass the governance decision table, and
that is where it stops. Live basis: `reasoning.deep`, reason `no approved model for
reasoning.deep`.

Both gates are working as designed. They are simply different gates, and only one family is
subject to the stricter one.

### Live, staging

```
migra-core    available=False   no approved model for chat.general
migra-logic   available=False   no approved model for reasoning.deep
migra-forge   available=True    qwen3-coder:30b        basis grant:typed-implementation
migra-swift   available=False   no approved model for chat.fast
migra-vision  available=False   no approved model for vision.general
migra-atlas   available=False   no approved model for chat.long_context
```

Four of the five unavailable families fail on a **governed capability**; none fails on a
mapping or a missing model.

---

## What would make Migra Logic selectable, and what must not

To make it available *legitimately*, on either host:

1. record a qualification **evidence run** for `deepseek-r1:32b` against `reasoning.deep`
   that **passes** and carries a **model digest** — the approval route rejects evidence that
   is missing, mismatched, failed, or digest-less;
2. **approve** it through `POST /api/ai/model-qualification/approve`, which requires a signed
   assertion;
3. on **staging only**, configure the qualification signing key first, since without it step 2
   returns 503 by design.

🚨 **What must not be done, and was not:** removing `governedCapability` from the family,
seeding the decisions table directly, or disabling enforcement. Each would make the selector
say "available" without anything having been approved — which is the precise failure mode this
governance exists to prevent, and the same class of defect as every other item this week.

**No recommendation is made here about whether `reasoning.deep` should be approved.** That is a
governance decision, and the point of the audit is that it is currently an *unmade* one rather
than a broken mechanism.

---

## Method note

Everything above was read from the running services. The one query I could not run was a direct
`SELECT` against `model_qualification_decisions` — my safety hook blocks `sudo` on the staging
host — so the table was read through the service's own read-only endpoint
`GET /api/ai/model-qualification/:capability`, which is the same data by the same code path the
resolver uses.
