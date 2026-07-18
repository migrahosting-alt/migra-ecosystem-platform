# MigraPilot Intelligent Provider Router — Local-First Coding Routing (Slice 2)

© MigraTeck LLC. Internal operational document.

## Purpose

Route **coding requests** through the highest-ranked eligible **local** provider/
model under the active execution policy, assess the outcome, and — when the policy
would prefer cloud or the local result is weak — **recommend fallback**. Slice 2
executes **locally only**: it never invokes a cloud provider. Automatic paid
fallback (with escalation + consent) is Slice 3.

## Routing contract

> Select the highest-ranked eligible **local** coding provider/model under the
> active policy.

No model family is hard-coded. Qwen (or any coder model) is *preferred* only
through declared capability / tier / priority metadata — the real discovered
eligible model wins (`rankLocalModels`).

## Governed surfaces

- **`POST /api/ai/engineer`** — the dedicated coding agent. Selects local-first;
  the tool/approval/proposal safety machinery is **unchanged** (selection is
  upstream of it). No local model → `503 NO_LOCAL_MODEL` with
  `fallbackRecommended` (cloud is not invoked).
- **`POST /api/ai/chat`** (coding turns only, via `preferCoding`/`isCodingIntent`)
  — the failover set is restricted to local models; the capability router's
  ordering + qualification gating are preserved; non-coding turns are unchanged.

## Fallback signal (advisory only)

`fallbackRecommended` is surfaced on the engineer `route`/`done` SSE frames and the
chat `routing` / streaming `done` frame. It is set when:

- the active policy ranks a **cloud** provider first (cloud-first / best-quality),
  **or**
- the bounded outcome assessment finds the local result empty, refused, below
  signal, or the run failed.

It **never** triggers a cloud call in this slice — it is a recommendation for the
human (or for Slice 3's escalation controls).

## Configuration

- `MIGRAPILOT_EXECUTION_POLICY` — active policy (default `auto`). Local-first,
  local-only, cloud-first, best-quality, lowest-cost, privacy-first, custom.
- Cloud providers remain **disabled by default** and are never invoked here
  regardless of policy.

## Invariants (tested)

- Under **every** policy the execution target is a local model or null — never a
  cloud model.
- The local router + assessment issue no completion and no cloud call (source
  scan).
- Coding-agent tool/approval/proposal machinery is untouched (selection only).
- Backward compatible: without the routing dependency, chat + engineer selection
  are unchanged.

## Next

Slice 3 adds real escalation + explicit consent so `fallbackRecommended` can, when
the operator permits, actually reach an enabled cloud provider under policy —
still fail-closed, still audited. Production delegation remains separate + disabled.
