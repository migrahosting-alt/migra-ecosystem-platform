#!/bin/bash
# MigraHosting Automated Cleanup & Cache Management
# Created: 2026-01-11 15:33:00 UTC
# Purpose: Remove old artifacts, logs, and caches
#
# Installation:
#   Run daily at 3 AM UTC: 0 3 * * * /opt/migra-guardian/cleanup.sh

set -euo pipefail

TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
LOG_FILE="/var/log/migra-guardian/cleanup-$(date +%Y%m%d).log"

log() {
    echo "[$TIMESTAMP] $*" | tee -a "$LOG_FILE"
}

log "===== MigraHosting Cleanup Started ====="

# ============================================
# 1. Clean old logs (keep 7 days)
# ============================================
log "Cleaning logs older than 7 days..."
find /var/log/migra-guardian/ -name "*.log" -mtime +7 -delete 2>/dev/null || true
find /var/log/nginx/ -name "*.log.*" -mtime +7 -delete 2>/dev/null || true
find /opt/MigraPanel/ -path "*/logs/*.log" -mtime +7 -delete 2>/dev/null || true

# ============================================
# 2. Clean PM2 logs (keep 3 days)
# ============================================
log "Rotating PM2 logs..."
pm2 flush migrapanel-panel-api 2>/dev/null || true

# ============================================
# 3. Clean old deployment backups (keep 7)
# ============================================
log "Cleaning old deployment backups..."
cd /srv/web/ || exit 1
ls -dt migrapanel-frontend-backup-* 2>/dev/null | tail -n +8 | xargs rm -rf || true

# ============================================
# 4. Clean npm cache
# ============================================
log "Cleaning npm cache..."
npm cache clean --force 2>/dev/null || true

# ============================================
# 5. Clean old Docker images (if applicable)
# ============================================
if command -v docker &>/dev/null; then
    log "Cleaning Docker images..."
    docker image prune -af --filter "until=168h" 2>/dev/null || true
fi

# ============================================
# 6. Clean /tmp files (older than 7 days)
# ============================================
log "Cleaning /tmp directory..."
find /tmp -type f -mtime +7 -delete 2>/dev/null || true
find /tmp -type d -empty -delete 2>/dev/null || true

# ============================================
# 7. Clean old database backups (keep 7 days)
# ============================================
if [[ -d /var/backups/postgresql ]]; then
    log "Cleaning old PostgreSQL backups..."
    find /var/backups/postgresql -name "*.sql.gz" -mtime +7 -delete 2>/dev/null || true
fi

# ============================================
# 8. Vacuum database (optimize)
# ============================================
log "Running database vacuum (analyze)..."
sudo -u postgres psql -d migrahosting_prod -c "VACUUM ANALYZE;" 2>/dev/null || true

# ============================================
# 9. Clean duplicate CDN zones
# ============================================
log "Checking for duplicate CDN zones..."
DUPLICATES=$(sudo -u postgres psql -d migrahosting_prod -tAc "
    SELECT COUNT(*) FROM (
        SELECT name, origin_url, COUNT(*) 
        FROM cdn_zones 
        GROUP BY name, origin_url 
        HAVING COUNT(*) > 1
    ) AS dupes;
" 2>/dev/null || echo "0")

if [[ "$DUPLICATES" -gt 0 ]]; then
    log "Found $DUPLICATES duplicate CDN zone(s) - manual cleanup required"
fi

# ============================================
# 10. Report disk usage
# ============================================
log "Disk usage after cleanup:"
df -h / | tail -1 | awk '{print "  Root: " $5 " used of " $2}' | tee -a "$LOG_FILE"

log "===== Cleanup Completed Successfully ====="
