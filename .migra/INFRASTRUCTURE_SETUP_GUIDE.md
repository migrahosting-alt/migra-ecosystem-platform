# MigraHosting Infrastructure Setup Guide
**Created:** 2026-01-11 15:34:00 UTC  
**Purpose:** Complete setup for monitoring, automation, and standardization

---

## 📁 Standardized Directory Structure

### Production Servers

```bash
/opt/mpanel/                          # Backend API (Node.js)
├── src/                              # TypeScript source files
├── dist/                             # Compiled JavaScript
├── logs/                             # Application logs
├── .env                              # Environment variables (SECRETS!)
├── package.json
└── node_modules/

/srv/web/mpanel-frontend/             # Frontend (React/Vite)
├── assets/                           # JS/CSS bundles
│   ├── index-{HASH}.js              # Main bundle
│   └── index-{HASH}.css             # Styles
├── brand/                            # Logos, favicon
└── index.html

/var/log/migra-guardian/              # Monitoring logs
├── health-YYYYMMDD.log              # Daily health check logs
└── cleanup-YYYYMMDD.log             # Cleanup script logs

/var/backups/                         # Automated backups
├── postgresql/                       # Database dumps
└── mpanel-frontend-YYYYMMDD/        # Frontend snapshots

/opt/migra-guardian/                  # Monitoring scripts
├── health_monitor.sh                # 30-second health checks
└── cleanup.sh                        # Daily cleanup tasks
```

### Development Workspace

```bash
/home/bonex/MigraWeb/MigraTeck-Ecosystem/dev/
├── migra-panel/                      # mPanel Development
│   ├── frontend/                     # React frontend source
│   │   ├── src/
│   │   ├── dist/                     # Build output
│   │   └── package.json
│   └── backend/                      # (deprecated)
│
├── mpanel-api/                       # Backend API development
│   ├── src/
│   ├── dist/
│   └── package.json
│
├── .migra/                           # Infrastructure management
│   ├── snapshots/                    # Infrastructure state
│   ├── runbooks/                     # Operations procedures
│   ├── scripts/                      # Automation scripts
│   │   ├── health_monitor.sh
│   │   └── cleanup.sh
│   └── DEPLOYMENT_LOG_*.md          # Timestamped deployment logs
│
└── logs/                             # Development logs
    ├── deployment/
    └── errors/
```

---

## 🚀 Installation Steps

### 1. Install Monitoring Scripts (mpanel-core)

```bash
# SSH into mpanel-core
ssh root@100.119.105.93

# Create directory
mkdir -p /opt/migra-guardian
mkdir -p /var/log/migra-guardian

# Copy scripts from development
scp /home/bonex/MigraWeb/MigraTeck-Ecosystem/dev/.migra/scripts/*.sh \
    root@100.119.105.93:/opt/migra-guardian/

# Make executable
chmod +x /opt/migra-guardian/*.sh

# Test health monitor
/opt/migra-guardian/health_monitor.sh

# Check logs
tail -f /var/log/migra-guardian/health-$(date +%Y%m%d).log
```

### 2. Setup Cron Jobs

```bash
# Edit crontab
crontab -e

# Add these lines:

# Health checks every 30 seconds
* * * * * /opt/migra-guardian/health_monitor.sh
* * * * * sleep 30 && /opt/migra-guardian/health_monitor.sh

# Daily cleanup at 3 AM UTC
0 3 * * * /opt/migra-guardian/cleanup.sh

# Weekly database backup at 2 AM Sunday
0 2 * * 0 /opt/migra-guardian/backup_database.sh

# Save and exit
```

### 3. Configure Slack Webhooks

```bash
# Create Slack webhook (if not exists)
# Go to: https://api.slack.com/apps → Create App → Incoming Webhooks

# Set environment variable
echo 'export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"' >> /etc/environment

# Reload environment
source /etc/environment

# Test Slack alert
curl -X POST -H 'Content-Type: application/json' \
    -d '{"text":"🚨 Test alert from MigraGuardian"}' \
    "$SLACK_WEBHOOK_URL"
```

### 4. Setup Log Rotation

```bash
# Create logrotate config
cat > /etc/logrotate.d/migra-guardian << 'EOF'
/var/log/migra-guardian/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root root
}
EOF

# Test rotation
logrotate -f /etc/logrotate.d/migra-guardian
```

---

## 🔐 Secrets Management

### Environment Variables Checklist

All secrets should be stored in `/opt/mpanel/.env` (NOT in Git):

```bash
# Database
DB_HOST=100.98.54.45
DB_PORT=5432
DB_NAME=migrahosting_prod
DB_USER=migrahosting
DB_PASSWORD=<SECRET>

# JWT
JWT_SECRET=<SECRET>
JWT_REFRESH_SECRET=<SECRET>

# Stripe
STRIPE_SECRET_KEY=<SECRET>
STRIPE_WEBHOOK_SECRET=<SECRET>

# Email
SMTP_HOST=mail.migrahosting.com
SMTP_PORT=587
SMTP_USER=noreply@migrahosting.com
SMTP_PASSWORD=<SECRET>

# Monitoring
SLACK_WEBHOOK_URL=<SECRET>

# API Keys
MPANEL_API_KEY=<SECRET>
GUARDIAN_API_KEY=<SECRET>
```

### Verify Secrets Not in Git

```bash
# Check for exposed secrets
cd /home/bonex/MigraWeb/MigraTeck-Ecosystem/dev
git grep -i "password\|secret\|key" -- "*.env" "*.env.*"

# Should return nothing!
```

---

## 📊 Monitoring Dashboard

### Check System Health

```bash
# View today's health log
tail -f /var/log/migra-guardian/health-$(date +%Y%m%d).log

# Count failures
grep "ERROR" /var/log/migra-guardian/health-$(date +%Y%m%d).log | wc -l

# Check last run
ls -lh /var/log/migra-guardian/ | tail -5
```

### Check Cleanup Status

```bash
# View cleanup log
tail -f /var/log/migra-guardian/cleanup-$(date +%Y%m%d).log

# Check disk space
df -h /

# Check old backups
ls -lh /srv/web/ | grep backup
```

---

## 🔄 Deployment Workflow

### Standard Deployment Process

```bash
# 1. Make changes in development
cd /home/bonex/MigraWeb/MigraTeck-Ecosystem/dev/migra-panel/frontend

# 2. Build frontend
npm run build

# 3. Deploy with timestamped backup
BACKUP_DIR="/srv/web/mpanel-frontend-backup-$(date +%Y%m%d_%H%M%S)"
rsync -avz --delete --backup --backup-dir="$BACKUP_DIR" \
    dist/ root@100.68.239.94:/srv/web/mpanel-frontend/

# 4. Log deployment
echo "[$(date -u +'%Y-%m-%d %H:%M:%S UTC')] Deployed frontend build $(git rev-parse --short HEAD)" \
    >> .migra/deployment-history.log

# 5. Verify in browser
# Open: https://mpanel.migrahosting.com
# Hard refresh: Ctrl+Shift+R

# 6. Monitor for errors
ssh root@100.119.105.93 "pm2 logs mpanel-api --lines 50"
```

### Rollback Procedure

```bash
# Find last backup
ssh root@100.68.239.94 "ls -td /srv/web/mpanel-frontend-backup-* | head -1"

# Restore backup
LAST_BACKUP=$(ssh root@100.68.239.94 "ls -td /srv/web/mpanel-frontend-backup-* | head -1")
ssh root@100.68.239.94 "rm -rf /srv/web/mpanel-frontend/* && cp -r $LAST_BACKUP/* /srv/web/mpanel-frontend/"

# Verify
curl -I https://mpanel.migrahosting.com
```

---

## 🐛 Troubleshooting

### Frontend Not Loading

```bash
# Check NGINX
ssh root@100.68.239.94 "nginx -t && systemctl status nginx"

# Check frontend files
ssh root@100.68.239.94 "ls -lh /srv/web/mpanel-frontend/assets/ | head -10"

# Check NGINX logs
ssh root@100.68.239.94 "tail -50 /var/log/nginx/error.log"
```

### Backend API Errors

```bash
# Check API status
ssh root@100.119.105.93 "pm2 status"

# Check API logs
ssh root@100.119.105.93 "pm2 logs mpanel-api --lines 100"

# Restart API
ssh root@100.119.105.93 "pm2 restart mpanel-api"
```

### Database Connection Issues

```bash
# Test database connection
ssh root@100.119.105.93 "
  cd /opt/mpanel &&
  node -e \"
    import pool from './dist/db/index.js';
    pool.query('SELECT NOW()').then(r => console.log('✓ DB OK:', r.rows[0].now))
      .catch(e => console.error('✗ DB ERROR:', e.message))
      .finally(() => process.exit());
  \"
"
```

---

## ✅ Post-Setup Checklist

- [ ] Health monitor running every 30 seconds
- [ ] Cleanup running daily at 3 AM UTC
- [ ] Slack webhooks configured and tested
- [ ] Log rotation configured
- [ ] All secrets in `/opt/mpanel/.env` (not in Git)
- [ ] Backups automated and verified
- [ ] Deployment logs timestamped in `.migra/`
- [ ] Old artifacts cleaned from /tmp
- [ ] React Router navigation persistence fixed
- [ ] All API endpoints use correct `/enterprise/*` paths

---

## 📞 Escalation

If automated monitoring fails, contact:

1. **Slack**: #migra-alerts channel
2. **Email**: ops@migrahosting.com
3. **Phone**: Emergency on-call rotation

**Critical Services Priority:**
1. Database (`db-core`: `100.77.51.91`)
2. Backend API (`migrapanel-core`: `100.68.175.27`)
3. Edge NGINX and reverse proxy (`nginx-proxy-core`: `100.101.106.88`)
4. Dedicated mail (`mail-core`: `100.114.228.57`, public `138.201.255.45`)
5. Primary DNS (`dns-core`: `100.126.11.116`)
6. Secondary DNS (`ns2-dns`: public `138.201.255.35`)
7. Cloud services (`cloud-core`: `100.113.190.42`)
8. Application runtime (`app-core`: `100.101.3.99`)
9. Voice (`voip-core`: `100.111.4.85`)
10. Proxmox (`pve`: `100.73.199.109`, public `138.201.255.55`)

---

**Last Updated:** 2026-04-17 02:05:00 UTC  
**Next Review:** 2026-04-24 15:00:00 UTC
