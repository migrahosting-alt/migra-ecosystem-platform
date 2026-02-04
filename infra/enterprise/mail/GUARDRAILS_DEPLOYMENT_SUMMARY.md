# Mail Server Guardrails - Deployment Summary

**Date:** 2026-02-04  
**Server:** vps-core (100.81.76.39)  
**Status:** ✅ DEPLOYED & ACTIVE

---

## What Was Deployed

### 1. Validation Script
**Location:** `/opt/migra/scripts/validate-mail-configs.sh`

**Purpose:** Validates that mail server configs match the canonical database credentials from panel-api .env

**Features:**
- Fetches DATABASE_URL remotely from mpanel-core (100.119.105.93)
- Checks all 3 Postfix configs and Dovecot config
- Verifies password, user, host, database name
- Tests actual database connectivity
- Auto-fix mode available with `--fix` flag

**Usage:**
```bash
# Check configs
ssh root@100.81.76.39 /opt/migra/scripts/validate-mail-configs.sh --verbose

# Auto-fix mismatches
ssh root@100.81.76.39 /opt/migra/scripts/validate-mail-configs.sh --fix
```

**Automation:** Runs every 6 hours via systemd timer (00:00, 06:00, 12:00, 18:00)

---

### 2. Authentication Monitor
**Location:** `/opt/migra/scripts/monitor-mail-auth.sh`

**Purpose:** Detects PostgreSQL authentication failures in real-time

**Features:**
- Scans journalctl logs for "password authentication failed"
- Alert threshold: 3+ failures in 5 minutes
- Rate limiting: Max 1 alert per 30 minutes
- Webhook & email alerting support

**Usage:**
```bash
# Manual check
ssh root@100.81.76.39 /opt/migra/scripts/monitor-mail-auth.sh

# With Slack webhook
ssh root@100.81.76.39 "/opt/migra/scripts/monitor-mail-auth.sh --alert-webhook https://hooks.slack.com/..."
```

**Automation:** Runs every 5 minutes via systemd timer

---

### 3. Config Sync Script
**Location:** `/opt/migra/scripts/sync-mail-configs.sh`

**Purpose:** Regenerates mail configs from panel-api .env (for password rotation)

**Features:**
- Fetches DATABASE_URL from mpanel-core
- Generates all 4 config files from template
- Creates automatic backups in `/etc/mail-configs-backups/`
- Sets correct ownership and permissions
- Reloads services safely
- Dry-run mode for testing

**Usage:**
```bash
# Dry-run (preview changes)
ssh root@100.81.76.39 /opt/migra/scripts/sync-mail-configs.sh --dry-run

# Sync configs (creates backups)
ssh root@100.81.76.39 /opt/migra/scripts/sync-mail-configs.sh

# Force sync even if validation passes
ssh root@100.81.76.39 /opt/migra/scripts/sync-mail-configs.sh --force
```

**When to Use:** After changing DATABASE_URL password in panel-api .env

---

### 4. Systemd Services

#### mail-auth-monitor.timer
- **Runs:** Every 5 minutes
- **Activates:** `mail-auth-monitor.service`
- **Purpose:** Continuous monitoring for auth failures

#### mail-config-validator.timer
- **Runs:** Every 6 hours (00:00, 06:00, 12:00, 18:00)
- **Activates:** `mail-config-validator.service`
- **Purpose:** Periodic config validation

**Check Status:**
```bash
ssh root@100.81.76.39 "systemctl list-timers mail-* --no-pager"
```

**View Logs:**
```bash
ssh root@100.81.76.39 "journalctl -u mail-auth-monitor.service -f"
ssh root@100.81.76.39 "journalctl -u mail-config-validator.service -n 50"
```

---

## Verification

All guardrails tested and verified:

✅ Validation script: Successfully validates all 4 mail configs  
✅ Monitoring script: Detects 0 auth failures (system healthy)  
✅ Sync script: Dry-run test successful  
✅ Systemd timers: Both active and scheduled  
✅ Config files: All match panel-api DATABASE_URL  
✅ Database connectivity: Verified from vps-core to db-core  

**Current Status:**
```
NEXT                            LEFT     LAST                       PASSED    UNIT
Wed 2026-02-04 07:16:38 CET      30s     Wed 2026-02-04 07:11:38 CET 4m ago  mail-auth-monitor.timer
Wed 2026-02-04 12:00:00 CET    4h 43min  Wed 2026-02-04 07:05:25 CET 10m ago mail-config-validator.timer
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  Mail Guardrail System                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  mpanel-core (100.119.105.93)                                  │
│    └─► panel-api/.env                                          │
│        └─► DATABASE_URL (source of truth)                      │
│                    ▲                                            │
│                    │ SSH fetch                                  │
│                    │                                            │
│  vps-core (100.81.76.39)                                       │
│    ├─► validate-mail-configs.sh ◄─── systemd timer (6h)       │
│    │   ├─► Checks Postfix configs                             │
│    │   ├─► Checks Dovecot config                              │
│    │   └─► Tests DB connectivity                              │
│    │                                                            │
│    ├─► monitor-mail-auth.sh ◄─── systemd timer (5min)         │
│    │   ├─► Scans journalctl                                   │
│    │   └─► Alerts on 3+ failures                              │
│    │                                                            │
│    └─► sync-mail-configs.sh                                    │
│        ├─► Regenerates configs                                │
│        ├─► Creates backups                                     │
│        └─► Reloads services                                    │
│                                                                  │
│  db-core (100.98.54.45)                                        │
│    └─► PostgreSQL migrapanel database                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## How It Prevents Future Issues

### Problem Scenario: Database Password Mismatch

**Before (No Guardrails):**
1. DBA changes DATABASE_URL password in panel-api
2. Mail configs still have old password
3. Auth failures every 2 minutes
4. Email clients show "Temporary authentication failure"
5. Manual intervention required to find and fix

**After (With Guardrails):**
1. DBA changes DATABASE_URL password in panel-api
2. Next validation run (max 6 hours later) detects mismatch
3. Validation logs error, timer can auto-fix or alert
4. Monitor detects auth failures within 5 minutes
5. Alerts sent to Slack/email if configured
6. DBA runs `sync-mail-configs.sh` to auto-fix
7. Services reload, system restored

---

## Operational Commands

### Daily Monitoring
```bash
# Check timer status
ssh root@100.81.76.39 "systemctl list-timers mail-*"

# View recent validation results
ssh root@100.81.76.39 "journalctl -u mail-config-validator.service -n 20"

# Check for auth failures
ssh root@100.81.76.39 "journalctl --since '1 hour ago' | grep 'password authentication failed'"
```

### After Password Change
```bash
# 1. Update panel-api .env on mpanel-core
ssh root@100.119.105.93
vi /opt/MigraPanel/apps/panel-api/.env
# Change DATABASE_URL password
systemctl restart migrapanel-panel-api.service

# 2. Sync mail configs on vps-core
ssh root@100.81.76.39 /opt/migra/scripts/sync-mail-configs.sh

# 3. Validate
ssh root@100.81.76.39 /opt/migra/scripts/validate-mail-configs.sh

# 4. Verify services
ssh root@100.81.76.39 "systemctl status postfix dovecot --no-pager"
```

### Emergency Fix
```bash
# If configs are wrong and causing auth failures:
ssh root@100.81.76.39 "/opt/migra/scripts/validate-mail-configs.sh --fix && systemctl reload postfix dovecot"
```

---

## Files Created

### On vps-core:
- `/opt/migra/scripts/validate-mail-configs.sh` - Validation script
- `/opt/migra/scripts/monitor-mail-auth.sh` - Monitor script
- `/opt/migra/scripts/sync-mail-configs.sh` - Sync script
- `/etc/systemd/system/mail-auth-monitor.service` - Monitor service
- `/etc/systemd/system/mail-auth-monitor.timer` - Monitor timer
- `/etc/systemd/system/mail-config-validator.service` - Validator service
- `/etc/systemd/system/mail-config-validator.timer` - Validator timer
- `/var/log/mail-auth-monitor.log` - Monitor log file
- `/etc/mail-configs-backups/` - Backup directory (created on first sync)

### In Workspace:
- `infra/enterprise/mail/validate-mail-configs.sh`
- `infra/enterprise/mail/monitor-mail-auth.sh`
- `infra/enterprise/mail/sync-mail-configs.sh`
- `infra/enterprise/mail/deploy-mail-guardrails.sh`
- `infra/enterprise/mail/systemd/*.{service,timer}`
- `infra/enterprise/mail/MAIL_SERVER_RUNBOOK.md`

---

## Alert Configuration (Optional)

To enable Slack/email alerts:

### Edit systemd service environment
```bash
ssh root@100.81.76.39
vi /etc/systemd/system/mail-auth-monitor.service

# Add under [Service]:
Environment="ALERT_WEBHOOK=https://hooks.slack.com/services/YOUR/WEBHOOK/HERE"
Environment="ALERT_EMAIL=ops@migrahosting.com"

systemctl daemon-reload
```

### Or pass directly to script
```bash
ssh root@100.81.76.39 "/opt/migra/scripts/monitor-mail-auth.sh --alert-webhook https://... --alert-email ops@migrahosting.com"
```

---

## Maintenance

### Weekly
- Review `/var/log/mail-auth-monitor.log`
- Check timer execution: `systemctl list-timers mail-*`

### Monthly
- Clean old backups: `ssh root@100.81.76.39 "find /etc/mail-configs-backups/ -mtime +90 -delete"`
- Verify scripts are executable: `ssh root@100.81.76.39 "ls -la /opt/migra/scripts/*.sh"`

### After System Updates
- Verify timers still enabled: `systemctl is-enabled mail-auth-monitor.timer mail-config-validator.timer`
- Test validation: `ssh root@100.81.76.39 /opt/migra/scripts/validate-mail-configs.sh`

---

## Success Metrics

✅ **Zero authentication failures** in journalctl logs  
✅ **All configs validated** every 6 hours automatically  
✅ **Monitoring active** every 5 minutes  
✅ **Auto-recovery** available via `--fix` flag  
✅ **Backups created** on every config sync  
✅ **Services reload** without downtime  

---

## Documentation

**Comprehensive Runbook:** `infra/enterprise/mail/MAIL_SERVER_RUNBOOK.md`

Contains:
- Architecture diagrams
- Troubleshooting procedures
- Emergency recovery steps
- Testing checklist
- Security best practices
- Maintenance schedule

---

## Summary

**Guardrails are ACTIVE and protecting against:**
- Database password drift
- Config file corruption
- Manual edit errors
- Undetected authentication failures
- Service degradation

**Recovery Time:**
- Detection: 5 minutes (monitor) to 6 hours (validator)
- Resolution: 1 command (`validate-mail-configs.sh --fix`)
- Downtime: 0 (reload, not restart)

**Next Steps:**
1. ✅ Guardrails deployed and active
2. ⏳ Monitor for 24-48 hours
3. ⏳ Configure Slack/email alerts (optional)
4. ⏳ Document password rotation procedure in team wiki

---

**Deployment completed successfully on 2026-02-04 by MigraAgent**
