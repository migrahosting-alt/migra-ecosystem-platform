# MigraPilot Console

Next.js operator console for Step 6:
- Chat + proposed tool calls
- Streaming tool execution timeline
- Diff review and patch apply flow
- Tier 3 approvals with human key turn
- Inventory and journal explorer

## Run

```bash
cd apps/migrapilot-console
npm install
npm --prefix ../migrapilot-runner-local install
npm --prefix ../migrapilot-runner-server install

npm run dev:runner-local
npm run dev:runner-server
npm run dev:console
npm run smoke:mission
```

Default URL: `http://localhost:3401`

## Required tooling dependency

The console executes tools by calling the runner HTTP services, and runners dispatch into `packages/tooling/dist/index.js`.
Build tooling first:

```bash
cd packages/tooling
npm run build
```

## Environment variables

```bash
# Required for signed Tier>=1 server jobs
MIGRAPILOT_JOB_SIGNING_KEY=replace_me

# Optional key map alternative
# MIGRAPILOT_JOB_SIGNING_KEYS={"default":"replace_me","rotated-2026-02":"replace_me_2"}

# Runner URLs
MIGRAPILOT_LOCAL_RUNNER_URL=http://localhost:7788
MIGRAPILOT_SERVER_RUNNER_URL=https://migrapilot-runner.internal:7789

# Inventory and journal source for packages/tooling runtime
MIGRAPILOT_INVENTORY_PATH=/etc/migrapilot/inventory.json
MIGRAPILOT_JOURNAL_PATH=/var/lib/migrapilot/journal.ndjson

# Server-side target for Next rewrites and local dev.
PILOT_API_URL=http://localhost:3377

# Leave the client base empty in shared or deployed env files so the browser
# uses same-origin /api routes and Next proxies to pilot-api server-side.
NEXT_PUBLIC_PILOT_API_BASE_URL=

# Optional durable artifact mirroring into MigraDrive
MIGRAPILOT_ARTIFACT_STORAGE_BACKEND=migradrive
MIGRAPILOT_ARTIFACT_PREFIX=migrapilot
S3_ENDPOINT=https://s3.migradrive.com
S3_REGION=us-east-1
S3_BUCKET=migrapilot-artifacts
S3_ACCESS_KEY_ID=migrapilot-app
S3_SECRET_ACCESS_KEY=replace_me
```

For local testing, point `MIGRAPILOT_INVENTORY_PATH` to a real inventory JSON fixture before starting `dev:runner-server`.

## API endpoints

- `POST /api/chat`
- `POST /api/execute` (SSE stream)
- `GET /api/journal/list`
- `GET /api/inventory/[resource]` where resource is `tenants|pods|domains|services|topology`
- `GET|POST /api/repo/[resource]` where resource is `search|read|files|status|diff|run`
- `GET /api/approvals`
- `POST /api/approvals/[approvalId]`
- `GET /api/state`
- `POST /api/mission/start`
- `POST /api/mission/step`
- `POST /api/mission/cancel`
- `GET /api/mission/[missionId]`
- `GET /api/mission/[missionId]/report`

## Notes

- Tier 3 actions are converted to pending approvals when `humanKeyTurnCode` is missing.
- Run/approval/chat state is stored in `.data/brain-state.json`.
- Mission orchestration state is stored in `.data/missions.json`.
- Drift snapshots, diffs, and mission report exports can be mirrored into `migrapilot-artifacts`.
- Tool input/output shown in UI is sanitized before storage/display.
- Runner contract is `POST /execute` with `{ toolName, input }`.

## Artifact Backfill

Once MigraDrive credentials are present, mirror the existing evidence layer:

```bash
cd apps/migrapilot-console
npm run ops:backfill-artifacts
```
