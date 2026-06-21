# MigraPilot Project Memory: pilot-web

Project: pilot-web  
Owner: MigraTeck / MigraHosting  
Framework: Next.js App Router  
Package manager: npm  
Dev port: 3399  

## Known Scripts

- npm run dev
- npm run build
- npm run start
- npm audit

## Known Routes

From latest build:

- /
- /pilot
- /pilot/admin
- /pilot/ops/playbooks
- /pilot/ops/runs
- /pilot/ops/runs/[runId]

## Verification Baseline

Latest known baseline:

- npm run build passes
- Next.js upgraded from 15.0.3 to 15.5.19
- npm audit still reports moderate PostCSS/Next advisory chain
- npm run dev failed because port 3399 was already in use
- Next.js warns about multiple package-lock.json files in monorepo/workspace

## Safety Notes

Do not run npm audit fix --force without approval.

Do not delete package-lock.json files until workspace structure is confirmed.

Do not modify routing or deployment behavior without testing all known routes.