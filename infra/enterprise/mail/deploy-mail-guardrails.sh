#!/bin/bash
#
# deploy-mail-guardrails.sh
# Deploy mail server guardrails to vps-core
#
# This script:
# - Copies validation, monitoring, and sync scripts to vps-core
# - Installs systemd services and timers
# - Sets up cron jobs
# - Validates deployment
#

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Configuration
VPS_CORE="${VPS_CORE:-root@dns-mail-core}"
REMOTE_SCRIPT_DIR="/opt/migra/scripts"
REMOTE_SYSTEMD_DIR="/etc/systemd/system"
LOCAL_BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================="
echo "Mail Server Guardrails Deployment"
echo "=========================================="
echo ""
log "Target: dns-mail-core"
log "Target host: $VPS_CORE"
log "Source: $LOCAL_BASE"
echo ""

# Step 1: Create remote directories
log "Creating remote directories..."
ssh "$VPS_CORE" "mkdir -p $REMOTE_SCRIPT_DIR /etc/mail-configs-backups /var/log/migra"

# Step 2: Copy scripts
log "Deploying scripts..."
scp "$LOCAL_BASE/validate-mail-configs.sh" "$VPS_CORE:$REMOTE_SCRIPT_DIR/"
scp "$LOCAL_BASE/monitor-mail-auth.sh" "$VPS_CORE:$REMOTE_SCRIPT_DIR/"
scp "$LOCAL_BASE/sync-mail-configs.sh" "$VPS_CORE:$REMOTE_SCRIPT_DIR/"

# Set permissions
ssh "$VPS_CORE" "chmod +x $REMOTE_SCRIPT_DIR/*.sh"
success "Scripts deployed"

# Step 3: Copy systemd units
log "Deploying systemd services and timers..."
scp "$LOCAL_BASE/systemd/mail-auth-monitor.service" "$VPS_CORE:$REMOTE_SYSTEMD_DIR/"
scp "$LOCAL_BASE/systemd/mail-auth-monitor.timer" "$VPS_CORE:$REMOTE_SYSTEMD_DIR/"
scp "$LOCAL_BASE/systemd/mail-config-validator.service" "$VPS_CORE:$REMOTE_SYSTEMD_DIR/"
scp "$LOCAL_BASE/systemd/mail-config-validator.timer" "$VPS_CORE:$REMOTE_SYSTEMD_DIR/"
success "Systemd units deployed"

# Step 4: Reload systemd and enable timers
log "Enabling systemd timers..."
ssh "$VPS_CORE" "systemctl daemon-reload"
ssh "$VPS_CORE" "systemctl enable mail-auth-monitor.timer"
ssh "$VPS_CORE" "systemctl enable mail-config-validator.timer"
ssh "$VPS_CORE" "systemctl start mail-auth-monitor.timer"
ssh "$VPS_CORE" "systemctl start mail-config-validator.timer"
success "Timers enabled and started"

# Step 5: Run initial validation
echo ""
log "Running initial validation..."
if ssh "$VPS_CORE" "$REMOTE_SCRIPT_DIR/validate-mail-configs.sh --verbose"; then
    success "Mail configs are valid"
else
    warn "Validation found issues. Running auto-fix..."
    ssh "$VPS_CORE" "$REMOTE_SCRIPT_DIR/validate-mail-configs.sh --fix"
    ssh "$VPS_CORE" "systemctl reload postfix dovecot"
    success "Configs fixed and services reloaded"
fi

# Step 6: Verify deployment
echo ""
log "Verifying deployment..."

echo "Checking scripts:"
ssh "$VPS_CORE" "ls -lh $REMOTE_SCRIPT_DIR/*.sh"

echo ""
echo "Checking systemd timers:"
ssh "$VPS_CORE" "systemctl list-timers mail-*"

echo ""
echo "Checking service status:"
ssh "$VPS_CORE" "systemctl status mail-auth-monitor.timer mail-config-validator.timer --no-pager" || true

# Step 7: Test monitor script
echo ""
log "Testing monitoring script..."
ssh "$VPS_CORE" "$REMOTE_SCRIPT_DIR/monitor-mail-auth.sh"

echo ""
echo "=========================================="
success "Deployment Complete!"
echo "=========================================="
echo ""
echo "Guardrails Deployed:"
echo "  ✓ Config validation script"
echo "  ✓ Auth failure monitor"
echo "  ✓ Config sync automation"
echo "  ✓ Systemd timers (auto-run)"
echo ""
echo "Monitoring Schedule:"
echo "  • Auth monitoring: Every 5 minutes"
echo "  • Config validation: Every 6 hours (00:00, 06:00, 12:00, 18:00)"
echo ""
echo "Manual Commands:"
echo "  Validate: ssh $VPS_CORE '$REMOTE_SCRIPT_DIR/validate-mail-configs.sh'"
echo "  Fix: ssh $VPS_CORE '$REMOTE_SCRIPT_DIR/validate-mail-configs.sh --fix'"
echo "  Sync: ssh $VPS_CORE '$REMOTE_SCRIPT_DIR/sync-mail-configs.sh'"
echo "  Monitor: ssh $VPS_CORE '$REMOTE_SCRIPT_DIR/monitor-mail-auth.sh'"
echo ""
echo "Check timers: ssh $VPS_CORE 'systemctl list-timers mail-*'"
echo "View logs: ssh $VPS_CORE 'journalctl -u mail-auth-monitor.service -f'"
echo ""
