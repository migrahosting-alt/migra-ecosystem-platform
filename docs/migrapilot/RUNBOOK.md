# MigraPilot Runbook

## 1) Install
```bash
cd packages/tooling && npm install && npm run build
cd ../../services/tool-runner && npm install && npm run build
cd ../pilot-api && npm install
cd ../../apps/pilot-web && npm install
```

## 2) Environment
Create `services/pilot-api/.env`:
```env
DATABASE_URL=postgresql://<user>:<pass>@<db-core-host>:5432/<db>
AUTH_JWT_SECRET=<reuse mPanel JWT secret>
APPROVAL_SIGNING_SECRET=<long-random>
PILOT_API_PORT=3377
MPANEL_API_BASE=http://100.97.213.11:2271
OPENAI_API_KEY=<optional>
PILOT_MODEL=gpt-4.1-mini
PILOT_MOCK_PODS_CREATE_SUCCESS=<optional:true for demo success path>
```

Create `apps/pilot-web/.env.local`:
```env
NEXT_PUBLIC_PILOT_API_BASE=http://localhost:3377
```

## 3) Database migration
```bash
cd services/pilot-api
npx prisma generate
npx prisma migrate dev --name init
```

## 4) Start services
```bash
cd services/pilot-api && npm run dev
cd ../../apps/pilot-web && npm run dev
```
Open `http://localhost:3399/pilot`.

## 5) Auth
- UI/API use existing MigraPanel JWT in `Authorization: Bearer <token>`.
- In browser, set `localStorage.setItem('token', '<jwt>')` before use.

## 6) Deploy notes
- Deploy `pilot-api` behind internal reverse proxy.
- Keep `OPENAI_API_KEY` server-side only.
- Ensure `audit_log` writes are enabled and monitored.

## 7) Fallback mode
- If no `OPENAI_API_KEY`, chat supports `/tool <name> <json>` command execution path.
