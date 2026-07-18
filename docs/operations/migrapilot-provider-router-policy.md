# MigraPilot Intelligent Provider Router — Registry & Policy (Slice 1)

© MigraTeck LLC. Internal operational document.

## Purpose

Give MigraPilot a truthful, inspectable model of its **providers** (local + cloud)
and **execution policies**, as the foundation for local-first routing. **Slice 1
changes no live routing** — it builds the registry, health, and policy model and
exposes them read-only. Actual routing begins in Slice 2.

## Scope boundary (Slice 1)

- Extends the **canonical capability-routed stack** (`modelRegistry` +
  `capabilityRouter` + `/api/ai/*`). The legacy profile router is untouched.
- No completion is ever issued by this subsystem; no `selectModel`/`decideRoute`
  call is made (enforced by an invariant test).
- Cloud providers (**OpenAI**, **Claude/Anthropic**) are **declared but disabled by
  default**. Local is enabled.

## Providers

A first-class `Provider`: `id`, `kind` (local | cloud), `protocol`,
`capabilities`, `priority`, `cost`, `dataLocality` (on-device | external),
`enabled`, and a `credentialEnv` — the **env var NAME** that supplies the key. The
credential **value is never stored, logged, or serialized**; only its presence
(`hasCredential`) is reported.

### Health (truthful, never fabricated)

`disabled` (not probed) · `unknown` (unprobed, or credential absent → not probed) ·
`unreachable` (probe failed) · `degraded` (reachable, no models) · `healthy`
(reachable + models). The probe is a read-only discovery GET that sends **no
credential** (any HTTP response proves reachability).

## Execution policies

`auto` · `local-first` · `local-only` · `cloud-first` · `best-quality` ·
`lowest-cost` · `privacy-first` · `custom` (uses Auto defaults until the Slice 5
UI). Default: `auto` (override with `MIGRAPILOT_EXECUTION_POLICY`).

The **PolicyEngine** produces a **dry-run selection plan** over a fleet snapshot:
a fail-closed exclusion pass (disabled / unreachable / credential-absent / missing
hard capability / policy-specific: local-only excludes cloud, privacy-first
excludes external without consent) then a transparent per-policy ranking with
reasons. `dryRun` is always `true` in Slice 1.

## Endpoints (read-only)

- `GET /api/ai/providers` — fleet snapshot (safe summaries + health + reconciled
  capabilities + safe model descriptors). `?refresh=true` actively probes.
- `GET /api/ai/providers/policies` — the policy catalog + default.
- `POST /api/ai/providers/plan` — `{ policy?, hints? }` → dry-run selection plan.

## Configuration (env)

- `MIGRAPILOT_EXECUTION_POLICY` — default policy (default `auto`).
- `MIGRAPILOT_PROVIDER_OPENAI_ENABLED` / `MIGRAPILOT_PROVIDER_ANTHROPIC_ENABLED` —
  enable a cloud provider (default false).
- `MIGRAPILOT_CLOUD_OPENAI_URL` / `MIGRAPILOT_CLOUD_ANTHROPIC_URL` — cloud base URLs.
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — credential VALUES (read only to send an
  authenticated request in a later slice; never surfaced).

## Guardrails

- No routing change, no completion, no hidden cloud usage in Slice 1.
- Cloud disabled by default; a disabled or credential-absent provider is never
  probed and is never a plan candidate.
- Credential values never appear in any response, log, or the plan.

## Next slices

2 local-first routing · 3 escalation/fallback controls · 4 cost & budget
governance · 5 provider-selection UI. Production delegation and live production
mutation remain a **separate governance program**, disabled throughout.
