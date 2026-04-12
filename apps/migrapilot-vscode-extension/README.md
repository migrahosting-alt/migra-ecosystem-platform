# MigraPilot VS Code Extension

VS Code client for MigraPilot pilot-api (`http://127.0.0.1:3377` by default).

Branding note: official source logos remain under `MigraEcosystem-Branding/`. The extension ships its own copied or derived assets from `apps/migrapilot-vscode-extension/media/` and does not modify the canonical branding files.

## Features

- Sidebar chat panel
- Commands:
  - `MigraPilot: Open Chat`
  - `MigraPilot: Inspect Service`
  - `MigraPilot: Assess Service Incident`
  - `MigraPilot: Preflight Operation`
  - `MigraPilot: Open Latest Audit Record`
  - `MigraPilot: Explain Selection`
  - `MigraPilot: Fix Selection`
  - `MigraPilot: Suggest Patch For File`
  - `MigraPilot: Apply Patch`
  - `MigraPilot: Run Tests`
  - `MigraPilot: Run Build`
  - `MigraPilot: Show Workspace Registry Summary`
  - `MigraPilot: Open Architecture Navigator`
  - `MigraPilot: Open Master Architecture`
  - `MigraPilot: Open Incident Operating Model`
  - `MigraPilot: Open Platform Autonomy Model`
  - `MigraPilot: Open Tenant Operating Model`
- Uses Brain API only (no direct runner access, no signing keys in extension)

## Workspace Governance Integration

MigraPilot can read workspace-root operating docs and machine-readable registries when they exist.

Expected registry files:

- `registry/commands.json`
- `registry/products.json`
- `registry/infrastructure.json`
- `registry/services.json`
- `registry/incidents.json`
- `registry/tenants.json`

The workspace summary command reports which of these sources are currently present and readable.

The service inspector command reads `registry/services.json` and shows dependency impact, healthcheck guidance, and operational risk context for a selected service.

The incident assessment command combines `registry/services.json` with `registry/incidents.json` to recommend severity, escalation level, and initial mitigation guidance for a selected service condition.

The architecture navigator command gives one Quick Pick entry point for the master blueprint, operating models, and machine-readable registry files.

The preflight command combines `registry/commands.json`, `registry/services.json`, and `registry/tenants.json` to flag approval requirements, tenant lifecycle blockers, service criticality, and validation checks before an operation proceeds.

Each preflight also writes a local JSON audit record under `.migrapilot/audit` by default, with a `runId`, command metadata, service context, tenant state, approval status, and blocking reasons.

Remote or production write operations sent through the Brain API can be configured to require a fresh successful preflight. When a fresh audit exists, MigraPilot attaches its `runId` and summary claims to the execution request.

## Settings

- `migrapilot.brainUrl` (default `http://127.0.0.1:3377`)
- `migrapilot.authToken` bearer JWT for remote or production pilot-api access
- `migrapilot.runnerTarget` (`auto|local|server`, default `auto`)
- `migrapilot.environment` (`dev|stage|staging|prod|test`, default `dev`)
- `migrapilot.operatorId` (optional)
- `migrapilot.auditPath` (default `.migrapilot/audit`)
- `migrapilot.preflightMaxAgeMinutes` (default `30`)
- `migrapilot.requirePreflightForRemoteWrites` (default `true`)

## Production setup

If you point the extension at a remote pilot-api, you must configure both:

```json
{
  "migrapilot.brainUrl": "http://100.119.105.93:3377",
  "migrapilot.authToken": "<bearer-jwt>"
}
```

You can set or clear the token from the Command Palette:

- `MigraPilot: Set Auth Token`
- `MigraPilot: Clear Auth Token`

Without an auth token, remote requests will fail by design.

## Dev

```bash
npm install
npm run build
```

Debug in VS Code:
1. Open this folder in VS Code
2. Press `F5` to launch extension host
3. Run commands from Command Palette

## Security model

- Extension never signs JWTs or jobs.
- Extension never contacts server runner directly.
- All operations go through Brain API.
