#!/bin/bash
# deploy-web-softphone.sh
# Builds and deploys the MigraVoice Web Softphone to srv1-web
#
# Usage: ./deploy-web-softphone.sh [--skip-build]

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${SCRIPT_DIR}/../../../migravoice-softphone"
WEB_SOFTPHONE_DIR="${PROJECT_ROOT}/apps/web-softphone"
TARGET_HOST="srv1-web"  # or use IP: root@73.139.18.218
TARGET_PATH="/var/www/call.migrahosting.com"
NGINX_CONF_SRC="/home/bonex/workspace/active/MigraTeck-Ecosystem/dev/infra/nginx/sites-available/call.migrahosting.com.conf"
NGINX_CONF_DEST="/etc/nginx/sites-available/call.migrahosting.com.conf"
NGINX_ENABLED_LINK="/etc/nginx/sites-enabled/call.migrahosting.com.conf"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if we should skip build
SKIP_BUILD=false
if [[ "$1" == "--skip-build" ]]; then
    SKIP_BUILD=true
fi

# Step 1: Build the web softphone
if [[ "$SKIP_BUILD" == "false" ]]; then
    log_info "Building web softphone..."
    cd "$WEB_SOFTPHONE_DIR"

    # Ensure production env
    if [[ ! -f .env.production ]]; then
        log_warn "No .env.production found, using defaults"
    fi

    # Build with Vite
    pnpm build

    if [[ ! -d dist ]]; then
        log_error "Build failed - no dist directory"
        exit 1
    fi

    log_info "Build complete: $(ls -la dist | wc -l) files"
else
    log_info "Skipping build (--skip-build flag)"
    cd "$WEB_SOFTPHONE_DIR"
fi

# Step 2: Deploy to server
log_info "Deploying to ${TARGET_HOST}:${TARGET_PATH}..."

# Create target directory
ssh root@${TARGET_HOST} "mkdir -p ${TARGET_PATH}"

# Sync dist files
rsync -avz --delete \
    "${WEB_SOFTPHONE_DIR}/dist/" \
    "root@${TARGET_HOST}:${TARGET_PATH}/"

log_info "Files synced successfully"

# Step 3: Deploy nginx config
log_info "Deploying nginx config..."

scp "${NGINX_CONF_SRC}" "root@${TARGET_HOST}:${NGINX_CONF_DEST}"

# Enable site if not already
ssh root@${TARGET_HOST} "
    if [[ ! -L ${NGINX_ENABLED_LINK} ]]; then
        ln -sf ${NGINX_CONF_DEST} ${NGINX_ENABLED_LINK}
        echo 'Site enabled'
    fi

    # Stop Apache if running (conflict with port 80)
    if systemctl is-active --quiet apache2; then
        echo 'Stopping Apache...'
        systemctl stop apache2
        systemctl disable apache2
    fi

    # Test nginx config
    nginx -t

    # Reload nginx
    systemctl reload nginx
"

log_info "nginx config deployed and reloaded"

# Step 4: Verify deployment
log_info "Verifying deployment..."

HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "https://call.migrahosting.com/" 2>/dev/null || echo "000")

if [[ "$HEALTH_CHECK" == "200" ]]; then
    log_info "✅ Deployment successful! https://call.migrahosting.com is live"
else
    log_warn "Health check returned ${HEALTH_CHECK} - may need SSL cert setup"
    log_info "Try: ssh root@${TARGET_HOST} certbot certonly --nginx -d call.migrahosting.com"
fi

echo ""
echo "=================================================="
echo "  MigraVoice Web Softphone Deployment Complete"
echo "=================================================="
echo "  URL: https://call.migrahosting.com"
echo "  Files: ${TARGET_PATH}"
echo "  Config: ${NGINX_CONF_DEST}"
echo "=================================================="
