# Mail Server Operational Runbook

**Server:** vps-core (100.81.76.39)  
**Hostname:** dns-mail-core.migrahosting.com  
**Services:** Postfix (SMTP/Submission), Dovecot (IMAP/LMTP)  
**Database:** PostgreSQL at db-core (100.98.54.45:5432)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Mail Flow                            │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Internet ──► NGINX (srv1-web) ──► vps-core            │
│                                      │                   │
│                                      ├─► Postfix         │
│                                      │   (SMTP/Submit)   │
│                                      │                   │
│                                      └─► Dovecot         │
│                                          (IMAP/LMTP)     │
│                                              │           │
│                                              ▼           │
│                                         PostgreSQL       │
│                                       (db-core)          │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Key Components

- **Postfix**: Handles incoming/outgoing SMTP, submission port 587
- **Dovecot**: Provides IMAP (143/993), LMTP delivery, SASL auth
- **PostgreSQL**: Stores mailbox users, domains, aliases, passwords (bcrypt)
- **Storage**: Maildir format at `/home/vmail/{domain}/{localpart}/`

---

## Configuration Files

### Source of Truth
- **Panel API `.env`**: `/opt/MigraPanel/apps/panel-api/.env`
  - Contains `DATABASE_URL=postgresql://user:password@host:port/database`
  - This is THE canonical source for database credentials

### Postfix Configs (Auto-generated)
- `/etc/postfix/sql/virtual_aliases.cf` - Alias lookups
- `/etc/postfix/sql/virtual_domains.cf` - Domain verification
- `/etc/postfix/sql/virtual_mailboxes.cf` - Mailbox path lookups

### Dovecot Configs (Auto-generated)
- `/etc/dovecot/dovecot-sql.conf.ext` - Authentication & user queries

### Ownership & Permissions
```bash
postfix:postfix 640 /etc/postfix/sql/*.cf
dovecot:dovecot 640 /etc/dovecot/dovecot-sql.conf.ext
```

---

## Guardrails & Automation

### 1. Config Validation Script
**Location:** `/opt/migra/scripts/validate-mail-configs.sh`

**Usage:**
```bash
# Check if configs match panel-api .env
/opt/migra/scripts/validate-mail-configs.sh --verbose

# Auto-fix mismatches
/opt/migra/scripts/validate-mail-configs.sh --fix

# Then reload services
systemctl reload postfix dovecot
```

**Runs Automatically:** Via cron every 6 hours
```cron
0 */6 * * * /opt/migra/scripts/validate-mail-configs.sh || /opt/migra/scripts/monitor-mail-auth.sh --alert-webhook $SLACK_WEBHOOK
```

### 2. Authentication Failure Monitoring
**Location:** `/opt/migra/scripts/monitor-mail-auth.sh`

**Purpose:** Detects PostgreSQL auth failures in real-time

**Usage:**
```bash
# Manual check
/opt/migra/scripts/monitor-mail-auth.sh

# With alerting
/opt/migra/scripts/monitor-mail-auth.sh \
  --alert-webhook https://hooks.slack.com/... \
  --alert-email ops@migrahosting.com
```

**Systemd Service:** `mail-auth-monitor.service` + timer (runs every 5 min)

### 3. Config Sync Automation
**Location:** `/opt/migra/scripts/sync-mail-configs.sh`

**Purpose:** Regenerates all mail configs from panel-api .env

**Usage:**
```bash
# Dry-run (see what would change)
/opt/migra/scripts/sync-mail-configs.sh --dry-run

# Sync configs from .env (safe, creates backups)
/opt/migra/scripts/sync-mail-configs.sh

# Force sync even if validation passes
/opt/migra/scripts/sync-mail-configs.sh --force
```

**When to Use:**
- After changing DATABASE_URL in panel-api .env
- After password rotation
- When validation script reports mismatches

---

## Common Operations

### Check Mail Service Health
```bash
# Service status
systemctl status postfix dovecot

# Recent logs
journalctl -u postfix -u dovecot -n 50

# Check for auth failures
journalctl --since "1 hour ago" | grep -i "authentication failed"

# Active connections
ss -tuln | grep -E ':(25|587|143|993|465)'
```

### Validate Configuration
```bash
# Quick validation
/opt/migra/scripts/validate-mail-configs.sh

# Test database connectivity
PGPASSWORD='your-pass' psql -h 100.98.54.45 -U migrapanel -d migrapanel -c "SELECT COUNT(*) FROM mailboxes"

# Test Postfix lookups
postmap -q noc@migrahosting.com pgsql:/etc/postfix/sql/virtual_mailboxes.cf
postmap -q migrahosting.com pgsql:/etc/postfix/sql/virtual_domains.cf

# Test Dovecot config syntax
doveconf -n
```

### Troubleshooting Auth Failures

**Symptoms:**
- "Temporary authentication failure" in email clients
- "password authentication failed for user 'migrapanel'" in logs

**Root Cause:** Config file passwords don't match panel-api DATABASE_URL

**Resolution:**
```bash
# 1. Verify the issue
/opt/migra/scripts/validate-mail-configs.sh --verbose

# 2. Fix configs automatically
/opt/migra/scripts/validate-mail-configs.sh --fix

# 3. Reload services (no downtime)
systemctl reload postfix dovecot

# 4. Verify fix
journalctl -f | grep -i "authentication"
postmap -q test@migrahosting.com pgsql:/etc/postfix/sql/virtual_mailboxes.cf

# 5. Test from client
# Try sending/receiving email in Thunderbird
```

### Manual Config Update (Not Recommended)

**⚠️ Use `sync-mail-configs.sh` instead! Manual edits will be overwritten.**

If you absolutely must edit manually:
```bash
# 1. Backup first
cp -p /etc/postfix/sql/virtual_domains.cf{,.bak}

# 2. Edit config
vi /etc/postfix/sql/virtual_domains.cf

# 3. Update password line
password = NewPasswordHere

# 4. Verify syntax
postmap -q test.com pgsql:/etc/postfix/sql/virtual_domains.cf

# 5. Reload
systemctl reload postfix

# 6. Document change
echo "$(date): Manual config edit" >> /var/log/mail-config-changes.log
```

### Password Rotation Procedure

**When rotating database passwords:**

```bash
# 1. Update panel-api .env
ssh root@100.119.105.93
vi /opt/MigraPanel/apps/panel-api/.env
# Change DATABASE_URL password

# 2. Restart panel-api
systemctl restart migrapanel-panel-api.service

# 3. Sync mail configs automatically
ssh root@100.81.76.39
/opt/migra/scripts/sync-mail-configs.sh

# 4. Verify all services
systemctl status postfix dovecot
/opt/migra/scripts/validate-mail-configs.sh
```

### Service Reload vs Restart

**Reload (Preferred):**
```bash
systemctl reload postfix dovecot
```
- No downtime
- Active connections preserved
- Config changes applied to new connections

**Restart (Emergency):**
```bash
systemctl restart postfix dovecot
```
- Brief downtime
- Kills active connections
- Use only if reload fails

---

## Monitoring & Alerts

### What to Monitor

1. **Authentication Failures**
   - Alert threshold: 3+ failures in 5 minutes
   - Auto-monitored by `mail-auth-monitor.service`

2. **Service Health**
   - Postfix: `systemctl is-active postfix`
   - Dovecot: `systemctl is-active dovecot`

3. **Database Connectivity**
   - Test: `validate-mail-configs.sh` exit code
   - Run every 6 hours via cron

4. **Queue Size**
   ```bash
   postqueue -p | tail -1
   ```
   Alert if queue > 100 messages

5. **Disk Usage**
   ```bash
   df -h /home/vmail
   ```
   Alert if > 80% full

### Alert Destinations

- **Slack Webhook:** Set in cron job or systemd service
- **Email:** `ops@migrahosting.com`
- **Logs:** `/var/log/mail-auth-monitor.log`

---

## Security Best Practices

### File Permissions
```bash
# Verify permissions
ls -la /etc/postfix/sql/
ls -la /etc/dovecot/dovecot-sql.conf.ext

# Should be:
# -rw-r----- 1 postfix postfix ... /etc/postfix/sql/*.cf
# -rw-r----- 1 dovecot dovecot ... /etc/dovecot/dovecot-sql.conf.ext
```

### Password Storage
- ✅ Stored in config files with 640 permissions (readable only by service user)
- ✅ Never log passwords
- ✅ Use environment variables for scripts
- ❌ Never commit passwords to git

### Regular Audits
```bash
# Check for world-readable configs
find /etc/postfix /etc/dovecot -type f -perm /o+r

# Verify config ownership
find /etc/postfix/sql -type f ! -user postfix
find /etc/dovecot -name "*.conf*" ! -user dovecot
```

---

## Emergency Procedures

### Mail Service Down

**1. Check service status:**
```bash
systemctl status postfix dovecot
journalctl -u postfix -u dovecot -n 100
```

**2. Check database connectivity:**
```bash
/opt/migra/scripts/validate-mail-configs.sh --verbose
```

**3. Restart if needed:**
```bash
systemctl restart postfix dovecot
```

**4. Check queue:**
```bash
postqueue -p
mailq
```

**5. Verify functionality:**
```bash
# Test SMTP
telnet localhost 25
# EHLO test.com
# QUIT

# Test IMAP
telnet localhost 143
# a LOGIN user@domain.com password
# a LOGOUT
```

### Database Connection Lost

**Symptoms:**
- All auth attempts fail
- "Connection refused" or "timeout" in logs

**Resolution:**
```bash
# 1. Check database server
ssh root@100.98.54.45
systemctl status postgresql

# 2. Verify network
ping 100.98.54.45
telnet 100.98.54.45 5432

# 3. Check pg_hba.conf allows vps-core
# On db-core:
cat /etc/postgresql/*/main/pg_hba.conf | grep 100.81.76.39

# 4. Restart mail services once DB is back
ssh root@100.81.76.39
systemctl restart postfix dovecot
```

### Config Corruption

**If configs are accidentally zeroed/corrupted:**

```bash
# 1. Check backups
ls -la /etc/mail-configs-backups/

# 2. Restore from latest backup
latest=$(ls -t /etc/mail-configs-backups/ | head -1)
cp /etc/mail-configs-backups/$latest/*.cf /etc/postfix/sql/
cp /etc/mail-configs-backups/$latest/dovecot-sql.conf.ext /etc/dovecot/

# 3. Fix permissions
chown postfix:postfix /etc/postfix/sql/*.cf
chown dovecot:dovecot /etc/dovecot/dovecot-sql.conf.ext
chmod 640 /etc/postfix/sql/*.cf /etc/dovecot/dovecot-sql.conf.ext

# 4. Reload
systemctl reload postfix dovecot

# 5. Or regenerate from .env
/opt/migra/scripts/sync-mail-configs.sh
```

---

## Testing Checklist

After any config change, verify:

```bash
# ✓ Config validation passes
/opt/migra/scripts/validate-mail-configs.sh

# ✓ Services active
systemctl is-active postfix dovecot

# ✓ No auth errors
journalctl --since "1 minute ago" | grep -i "authentication failed" | wc -l
# Should be 0

# ✓ Database lookups work
postmap -q noc@migrahosting.com pgsql:/etc/postfix/sql/virtual_mailboxes.cf

# ✓ Database connectivity
PGPASSWORD='password' psql -h 100.98.54.45 -U migrapanel -d migrapanel -c "SELECT 1"

# ✓ Test email send/receive
# Use Thunderbird or mail client

# ✓ Check queue is empty
postqueue -p | tail -1
# Should show "Mail queue is empty" or "-- 0 Kbytes in 0 Request"
```

---

## Maintenance Schedule

### Daily
- Automated config validation (via cron)
- Auth failure monitoring (via systemd timer)

### Weekly
- Review monitoring logs
- Check disk usage on `/home/vmail`

### Monthly
- Review and clean old backups in `/etc/mail-configs-backups/`
- Audit file permissions
- Review and rotate logs

### Quarterly
- Password rotation (if required by policy)
- Review and update this runbook
- Test disaster recovery procedures

---

## Contact & Escalation

**Automation:** All guardrails deployed and active
- Validation runs every 6 hours
- Monitoring runs every 5 minutes
- Auto-fix available via `--fix` flag

**Manual Intervention Required:**
- Database server down
- Network connectivity issues
- Disk space exhaustion
- Service crashes (not config issues)

**Related Documentation:**
- Panel API: `/opt/MigraPanel/apps/panel-api/README.md`
- Database Schema: `migra-panel/DATABASE_SCHEMA.md`
- Infrastructure: `infra/enterprise/README.md`

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-02-04 | Initial runbook + guardrails deployment | MigraAgent |
| 2026-02-04 | Auth failure incident resolved | MigraAgent |
