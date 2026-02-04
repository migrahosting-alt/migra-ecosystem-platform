# Deploy mailcore-api to New Mail Server (100.81.76.39)

**Date:** 2026-01-26  
**Target:** 100.81.76.39 (154.38.180.61 public)  
**Source:** legacy mail host (decommissioned)  
**Operator:** MigraAgent

---

## Prerequisites Verification

✅ **New server has:**
- Dovecot SQL config: `/etc/dovecot/dovecot-sql.conf.ext`
- DB connection: `host=100.98.54.45 dbname=mail user=mail_user`
- vmail user: `5000:5000`
- vmail directory: `/var/vmail`
- Postfix + Dovecot running

---

## Deployment Steps

### 1. Copy Application Files from Legacy Backup

```bash
# From WSL/local machine
# Use your archived backup bundle (legacy mail host is decommissioned)
scp /path/to/mailcore-api.tar.gz root@100.81.76.39:/tmp/
```

### 2. Deploy on New Server

```bash
ssh root@100.81.76.39 << 'EOF'
# Extract application
cd /opt
tar xzf /tmp/mailcore-api.tar.gz
rm /tmp/mailcore-api.tar.gz
chown -R root:root /opt/mailcore-api

# Verify Node.js is installed
node --version || (curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs)

# Test dependencies
cd /opt/mailcore-api
npm install --production
EOF
```

### 3. Create Environment Configuration

```bash
ssh root@100.81.76.39 << 'EOF'
cat > /etc/mailcore-api.env << 'ENVEOF'
MAILCORE_API_TOKEN=8941d7b2cc20cea5b7b84032b02d156a7c7ae5a186de5e12d75e17af0b7859be
MAILCORE_ALLOWLIST=100.119.105.93,100.68.239.94
MAILCORE_BIND_HOST=100.81.76.39
MAILCORE_PORT=9080
MAILCORE_DB_CONFIG_PATH=/etc/dovecot/dovecot-sql.conf.ext
MAILCORE_MAILDIR_ROOT=/var/vmail
MAILCORE_MAIL_UID=5000
MAILCORE_MAIL_GID=5000
MAILCORE_DELETE_MODE=disable
ENVEOF

chmod 600 /etc/mailcore-api.env
EOF
```

### 4. Create systemd Service

```bash
ssh root@100.81.76.39 << 'EOF'
cat > /etc/systemd/system/mailcore-api.service << 'SERVICEEOF'
[Unit]
Description=VPS-core Mail HTTP API
After=network.target dovecot.service postfix.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/mailcore-api
EnvironmentFile=/etc/mailcore-api.env
ExecStart=/usr/bin/node /opt/mailcore-api/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mailcore-api

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/vmail

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable mailcore-api.service
EOF
```

### 5. Start Service and Verify

```bash
ssh root@100.81.76.39 "systemctl start mailcore-api.service && systemctl status mailcore-api.service --no-pager"
```

### 6. Health Check

```bash
# From panel-api host
ssh root@100.119.105.93 "curl -v http://100.81.76.39:9080/health"

# Should return: {"status":"ok"}
```

### 7. Test from Panel API (if service is running)

```bash
ssh root@100.119.105.93 "curl -H 'Authorization: Bearer 8941d7b2cc20cea5b7b84032b02d156a7c7ae5a186de5e12d75e17af0b7859be' http://100.81.76.39:9080/health"
```

---

## Rollback Plan

If deployment fails:

```bash
# Stop new service
ssh root@100.81.76.39 "systemctl stop mailcore-api.service && systemctl disable mailcore-api.service"

# Revert panel-api .env to old server
ssh root@100.119.105.93 "cd /opt/MigraPanel/apps/panel-api && sed -i 's|MAILCORE_API_BASE=http://100.81.76.39:9080|MAILCORE_API_BASE=http://100.64.119.23:9080|' .env && systemctl restart migrapanel-panel-api.service"
```

---

## Post-Deployment Validation

1. ✅ Health endpoint responds
2. ✅ Panel-api can connect
3. ✅ Create test email account via panel
4. ✅ Send test email
5. ✅ Check logs: `journalctl -u mailcore-api.service -f`

---

## Notes

- **Token:** Same token used on old server (`8941d7b2cc20cea5b7b84032b02d156a7c7ae5a186de5e12d75e17af0b7859be`)
- **Bind IP:** Changed to `100.81.76.39` (new Tailscale IP)
- **Maildir:** Changed to `/var/vmail` (instead of `/home/vmail`)
- **Allowlist:** Includes panel-api (100.119.105.93) and srv1-web (100.68.239.94)
