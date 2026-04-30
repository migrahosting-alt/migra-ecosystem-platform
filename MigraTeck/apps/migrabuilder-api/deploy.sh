#!/usr/bin/env bash
# deploy-migrabuilder.sh
# Deploys MigraBuilder API (port 3200) and Web (static, served by nginx)
# Run from: dev/MigraTeck/
# Target: app-core (100.101.3.99)

set -euo pipefail

APP_CORE="root@100.101.3.99"
NGINX_PROXY="root@100.101.106.88"
REMOTE_DIR="/opt/migrabuilder"
BUILDER_DOMAIN="${BUILDER_DOMAIN:-builder.migrahosting.com}"
API_PORT=3200

echo "=== MigraBuilder Deploy ==="
echo "Target: $APP_CORE"
echo "Domain: $BUILDER_DOMAIN"
echo ""

# ── 1. Build API ─────────────────────────────────────────────────────
echo "→ Building migrabuilder-api..."
cd apps/migrabuilder-api
npm install --legacy-peer-deps
npm run build
cd ../..

# ── 2. Build Web ─────────────────────────────────────────────────────
echo "→ Building migrabuilder-web..."
cd apps/migrabuilder-web
npm install --legacy-peer-deps
VITE_API_BASE="/api" npm run build
cd ../..

# ── 3. Push API to app-core ───────────────────────────────────────────
echo "→ Pushing API to app-core..."
ssh "$APP_CORE" "mkdir -p ${REMOTE_DIR}/api"
rsync -az --delete \
  apps/migrabuilder-api/dist/ \
  apps/migrabuilder-api/package.json \
  apps/migrabuilder-api/package-lock.json \
  "${APP_CORE}:${REMOTE_DIR}/api/"

# ── 4. Push Web (static) to app-core ─────────────────────────────────
echo "→ Pushing web static files to app-core..."
ssh "$APP_CORE" "mkdir -p ${REMOTE_DIR}/web"
rsync -az --delete apps/migrabuilder-web/dist/ "${APP_CORE}:${REMOTE_DIR}/web/"

# ── 5. Install API deps + run migrations + restart PM2 ───────────────
echo "→ Installing API deps and restarting on app-core..."
ssh "$APP_CORE" bash <<REMOTE
  set -e
  cd ${REMOTE_DIR}/api

  # Install production deps
  npm install --omit=dev --legacy-peer-deps

  # Run DB migration (idempotent)
  if [ -f "src/db/schema.sql" ]; then
    echo "Migrations: running schema.sql via psql..."
    psql "\$DATABASE_URL" -f src/db/schema.sql || true
  fi

  # Start/restart via PM2
  if pm2 describe migrabuilder-api > /dev/null 2>&1; then
    pm2 restart migrabuilder-api
  else
    pm2 start dist/server.js \
      --name migrabuilder-api \
      --env production \
      -- \
      && pm2 save
  fi
  echo "API running on port $API_PORT"
REMOTE

# ── 6. Push nginx vhost to nginx-proxy-core ──────────────────────────
echo "→ Configuring nginx vhost on nginx-proxy-core..."
NGINX_CONF=$(cat <<NGINX
server {
    listen 80;
    server_name ${BUILDER_DOMAIN} api.${BUILDER_DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${BUILDER_DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${BUILDER_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${BUILDER_DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # API proxy — /api → migrabuilder-api
    location /api/ {
        proxy_pass         http://10.10.0.10:${API_PORT}/api/;
        proxy_http_version 1.1;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }

    # Health check
    location /health {
        proxy_pass http://10.10.0.10:${API_PORT}/health;
        proxy_http_version 1.1;
    }

    # Static web app (served from app-core)
    location / {
        proxy_pass         http://10.10.0.10:3201/;
        proxy_http_version 1.1;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }
}
NGINX
)

ssh "$NGINX_PROXY" "cat > /etc/nginx/sites-available/${BUILDER_DOMAIN}.conf << 'EOF'
${NGINX_CONF}
EOF
ln -sf /etc/nginx/sites-available/${BUILDER_DOMAIN}.conf /etc/nginx/sites-enabled/${BUILDER_DOMAIN}.conf
nginx -t && nginx -s reload"

# ── 7. Serve static web files on app-core via http-server or nginx ───
echo "→ Starting static file server for web on app-core (port 3201)..."
ssh "$APP_CORE" bash <<REMOTE
  set -e
  # Check if serve/http-server is available, else install
  if ! command -v serve &>/dev/null; then
    npm install -g serve
  fi

  # Stop existing static server if running
  pm2 delete migrabuilder-web 2>/dev/null || true

  # Start
  pm2 start serve \
    --name migrabuilder-web \
    -- -s ${REMOTE_DIR}/web -l 3201 --no-clipboard
  pm2 save
  echo "Web static server running on port 3201"
REMOTE

echo ""
echo "✅ MigraBuilder deployed!"
echo "   → https://${BUILDER_DOMAIN}"
echo "   → API health: https://${BUILDER_DOMAIN}/health"
echo ""
echo "Next steps:"
echo "  1. Provision PostgreSQL DB on app-core (see README below)"
echo "  2. Set env vars in /opt/migrabuilder/api/.env on app-core"
echo "  3. Issue SSL cert: certbot --nginx -d ${BUILDER_DOMAIN}"
