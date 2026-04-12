#!/usr/bin/env bash
set -euo pipefail

if [[ "${ALLOW_PRISMA_DB_PUSH:-false}" != "true" ]]; then
  cat <<'EOF'
[prisma-push] blocked
`prisma db push` is disabled by default for MigraTeck because it can create schema drift.

Use one of these instead:
  npm run prisma:migrate
  npm run prisma:deploy
  npm run prisma:verify

If you are intentionally working against a disposable local database, rerun with:
  ALLOW_PRISMA_DB_PUSH=true npm run prisma:push:unsafe
EOF
  exit 1
fi

echo "[prisma-push] proceeding because ALLOW_PRISMA_DB_PUSH=true"
npx prisma db push "$@"

