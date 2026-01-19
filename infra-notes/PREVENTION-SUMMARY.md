# Prevention Measures Implemented

**Date:** January 19, 2026  
**Issue:** UFW FORWARD policy blocking VM internet access → Tailscale connectivity loss  
**Impact:** All VMs lost Tailscale connectivity for ~1 hour

---

## ✅ Implemented Solutions

### 1. Documentation Created

**[FIREWALL-CONFIG.md](./FIREWALL-CONFIG.md)**
- Comprehensive explanation of the problem
- Correct UFW configuration for hypervisors
- Recovery procedures
- Manual verification commands

**[QUICK-REFERENCE.md](./QUICK-REFERENCE.md)**
- Emergency procedures for common issues
- Quick-fix commands
- System health checks

**[README.md](./README.md) Updated**
- Added firewall management section
- Links to detailed docs
- Quick verification commands

### 2. Automation Scripts on pve

All scripts located in `/root/` on pve (100.73.199.109):

**`verify-firewall.sh`** (2.6KB)
- Checks UFW installation and status
- Verifies FORWARD policy is ACCEPT
- Tests VM internet connectivity
- Tests VM DNS resolution
- Checks Tailscale mesh health
- Exit code 1 if issues found

Usage:
```bash
ssh root@100.73.199.109 "bash /root/verify-firewall.sh"
```

**`restore-firewall.sh`** (1.1KB)
- Resets UFW to correct configuration
- Sets all three default policies correctly
- Configures required rules (Tailscale, SSH, hosting-agent)
- Runs verification after restore

Usage:
```bash
ssh root@100.73.199.109 "bash /root/restore-firewall.sh"
```

**`ufw-config-backup.txt`**
- Snapshot of known-good UFW configuration
- Created: January 19, 2026

### 3. Automated Monitoring

**`/etc/cron.hourly/check-firewall`** (497 bytes)
- Runs every hour via cron
- Checks FORWARD policy
- Logs to syslog if misconfigured
- Can be uncommented to auto-fix (disabled by default for safety)

Check logs:
```bash
ssh root@100.73.199.109 "journalctl -t firewall-check --since '1 hour ago'"
```

### 4. Configuration Backup

Current UFW configuration backed up to:
- `/root/ufw-config-backup.txt` on pve

---

## 🔍 How This Prevents Recurrence

### Before This Fix:
- No documentation of correct firewall config
- No automated verification
- No monitoring of FORWARD policy
- Manual recovery required deep networking knowledge

### After This Fix:
1. **Documentation** - Anyone can understand the issue and fix it
2. **Verification** - One command checks entire firewall health
3. **Restoration** - One command restores correct config
4. **Monitoring** - Hourly checks log issues to syslog
5. **Backup** - Known-good config saved for reference

---

## 📋 Maintenance Checklist

### After Any UFW Change on pve:
```bash
# 1. Verify configuration
ssh root@100.73.199.109 "bash /root/verify-firewall.sh"

# 2. Update backup
ssh root@100.73.199.109 "ufw status verbose > /root/ufw-config-backup.txt"

# 3. Document changes in FIREWALL-CONFIG.md
```

### Monthly Health Check:
```bash
# Run full verification
ssh root@100.73.199.109 "bash /root/verify-firewall.sh"

# Check for logged issues
ssh root@100.73.199.109 "journalctl -t firewall-check --since '30 days ago' | grep CRITICAL"

# Verify all VMs on Tailscale
ssh root@100.73.199.109 "tailscale status | grep -c offline"
```

---

## 🚨 Emergency Recovery

If all VMs lose Tailscale connectivity again:

```bash
# One-line fix
ssh root@100.73.199.109 "ufw default allow forward && ufw reload && bash /root/verify-firewall.sh"
```

Or use the full restore:
```bash
ssh root@100.73.199.109 "bash /root/restore-firewall.sh"
```

---

## 📚 Related Files

**Local Repository:**
- `infra-notes/FIREWALL-CONFIG.md` - Detailed documentation
- `infra-notes/QUICK-REFERENCE.md` - Emergency procedures
- `infra-notes/README.md` - Updated with firewall warnings

**On pve (100.73.199.109):**
- `/root/verify-firewall.sh` - Health check script
- `/root/restore-firewall.sh` - Restoration script
- `/root/ufw-config-backup.txt` - Configuration backup
- `/etc/cron.hourly/check-firewall` - Monitoring cron job

---

## ✅ Tested and Verified

All scripts tested on January 19, 2026:
- ✅ `verify-firewall.sh` - All checks passing
- ✅ `restore-firewall.sh` - Created (not executed to avoid disruption)
- ✅ Monitoring cron job - Running hourly, no issues logged
- ✅ Documentation - Complete and accessible

**Status:** IMPLEMENTED ✅
