# BoAI enterprise CI: current workspace and legacy benchmark availability

Investigation date: 2026-10-23. Inspected canonical commit:
`35031f147773ade87e262b9d28e0f63fbe968d6f`.

## Finding

Run [39895958357](https://github.com/migrahosting-alt/migra-ecosystem-platform/actions/runs/39895958357)
failed before application checks: setup-node could not resolve
`services/pilot-api/package-lock.json`; cleanup also used the absent directory.
The complete Git tree contains **zero services/pilot-api files**. There is no
tracked replacement directory providing its Prisma/API/benchmark npm scripts.
Changing that path to brain-service would invoke unrelated or nonexistent commands.
This is infrastructure/source availability failure, not failed model acceptance.

The root package.json defines the maintained npm workspace: apps/brain-service,
apps/vscode-extension and shared packages. The existing replacement for its
**deterministic code validation** is `.github/workflows/gap2-repro.yml`:
`fresh-clone-proof`, enforced by `canonical-integration-gate`. It builds workspaces
and runs Brain and canonical-extension tests. The older extension workflow targets
apps/migrapilot-vscode and is not a substitute for canonical-extension validation.

## Correction and scope

The existing enterprise workflow filename remains stable; its display name is
BoAI Enterprise Gate. A root-lockfile, Node 22 job now runs on scoped PRs, pushes
to main/canonical, nightly and manual dispatch. It uses npm ci, clean, typecheck,
build, Brain deterministic tests, canonical-extension unit/transport/safety checks,
integration-gate decision tests, production audit (moderate and above), and
all-dependency audit (high and critical). All checks fail on nonzero exit.
The aggregate gate requires this job for the same PR path filters, including
workflow and gate-script changes. Existing security and repository gates remain.

The daily cron remains 03:20 UTC. The default dispatch profile is `workspace`.
Deep/full profiles are retained as explicit **legacy pilot-api** checks (manual
profiles, plus the existing scheduled full profile);
they fail before setup-node with an actionable source-prerequisite error while
the component is absent. Cleanup is guarded against that absent directory.
The old dependency audit no longer swallows failures. Benchmark thresholds,
evaluations, policy verification and supply-chain guardrails are preserved.
No failed model evaluation has been reclassified as a pass.

## Qualification gap: NOT retired or equivalent

Workspace CI is not a live-model benchmark or permission to promote a model.
There is no verified equivalent replacement for legacy chat reliability, latency,
regression, path answers, degraded fallback, prompt contracts, golden replay,
failure injection, observability, burn-rate, policy signing or shadow replay.
Production code still has an opt-in remote-pilot adapter; missing tracked source
does not establish that the deployed pilot-api has been retired.

Before retiring the legacy profiles, locate the authoritative maintained pilot-api
repository/commit or record an explicit retirement decision. If maintained, restore
its tracked source, lockfile and configuration and prove both profiles from a clean
checkout with authorized credentials. If superseded, map every legacy acceptance
requirement to an executable successor and record live evidence before removal.
Until then the profiles remain available and fail closed, including the nightly
full-profile prerequisite. The overall nightly workflow cannot be green while
legacy acceptance inputs are missing. Do not claim current
BoAI Assistant deployment or model qualification from this repository's checks.
