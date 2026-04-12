# MigraPilot Desktop (Windows)

Electron desktop wrapper for MigraPilot Brain + local runner + embedded console.

## What it does

- Starts local services on app boot:
  - Brain API: `http://localhost:7777`
  - Local runner: `http://localhost:7788`
  - Embedded console UI (Next.js): `http://localhost:7776`
- Embeds the existing `apps/migrapilot-console` UI inside a desktop window.
- Exposes desktop control panel:
  - service status + start/stop/restart
  - settings editor
  - Tier 3 approval queue
- Brain `/api/execute` signs jobs with `MIGRAPILOT_JOB_SIGNING_KEY` and routes by tool scope/tier/env.

## Environment

- `MIGRAPILOT_JOB_SIGNING_KEY` (required for signed operations)
- `MIGRAPILOT_LOCAL_RUNNER_URL` (default `http://127.0.0.1:7788`)
- `MIGRAPILOT_SERVER_RUNNER_URL` (default from desktop settings)
- `MIGRAPILOT_POLICY_MODE` (`active` or `read-only`, optional)
- `MIGRAPILOT_WORKSPACE_ROOT` (optional, defaults to repo root inferred from app path)
- `MIGRAPILOT_DESKTOP_CONSOLE_MODE` (`dev` or `start`, default `dev`)

## Scripts

```bash
npm install
npm run build
npm run dev:desktop
```

Windows installer:

```bash
npm run dist:desktop
```

Brain execute smoke (requires app running):

```bash
npm run smoke:brain
```

## Settings path

Desktop settings are stored in Electron `userData`:

- `%APPDATA%/MigraPilot/settings.json` (Windows)

Fields:
- `serverRunnerUrl`
- `operatorId`
- `role`
- `defaultEnvironment`
- `defaultRunnerTarget`

## Security notes

- Brain returns `jobId` but never returns `job.signature`.
- Signing keys are never shown in UI or logs.
- API/log output is redacted for keys matching `secret|token|password|signature|authorization`.
