#!/usr/bin/env bash
set -euo pipefail

# Restores the working mail stack from the legacy dns-mail container
# onto the dedicated Hetzner mail-core VM.

PVE_HOST="${PVE_HOST:-root@138.201.255.55}"
TARGET_HOST="${TARGET_HOST:-root@10.10.0.8}"
SOURCE_CT_ID="${SOURCE_CT_ID:-510}"

run_on_pve() {
  ssh "$PVE_HOST" "$@"
}

echo "[1/8] Verifying source and target reachability"
run_on_pve "pct exec '$SOURCE_CT_ID' -- hostname >/dev/null && ssh -o BatchMode=yes -o ConnectTimeout=5 '$TARGET_HOST' 'hostname'"

echo "[2/8] Ensuring vmail identity and target directories exist"
run_on_pve "ssh '$TARGET_HOST' '
  getent group vmail >/dev/null || groupadd -g 5000 vmail
  id -u vmail >/dev/null 2>&1 || useradd -u 5000 -g 5000 -d /home/vmail -s /usr/sbin/nologin vmail
  mkdir -p /home/vmail /var/vmail /var/log/dovecot
  mkdir -p /etc/letsencrypt/archive/mail.migrahosting.com /etc/letsencrypt/live/mail.migrahosting.com
  mkdir -p /etc/letsencrypt/archive/mail.migrateck.com /etc/letsencrypt/live/mail.migrateck.com
  mkdir -p /etc/opendkim/keys
'"

echo "[3/8] Stopping target services before sync"
run_on_pve "ssh '$TARGET_HOST' '
  systemctl stop nginx 2>/dev/null || true
  systemctl stop dovecot 2>/dev/null || true
  systemctl stop opendkim 2>/dev/null || true
  systemctl stop postfix@- 2>/dev/null || true
'"

copy_from_ct() {
  local source_path="$1"
  local target_path="$2"
  run_on_pve "pct exec '$SOURCE_CT_ID' -- tar -C / -cf - '$source_path' | ssh '$TARGET_HOST' \"tar -C '$target_path' -xf - --strip-components=1\""
}

echo "[4/8] Syncing mail data"
copy_from_ct "home/vmail" "/home/vmail"
copy_from_ct "var/vmail" "/var/vmail"

echo "[5/8] Syncing Postfix, Dovecot, and OpenDKIM config"
run_on_pve "pct exec '$SOURCE_CT_ID' -- cat /etc/postfix/main.cf | ssh '$TARGET_HOST' 'cat > /etc/postfix/main.cf'"
run_on_pve "pct exec '$SOURCE_CT_ID' -- cat /etc/postfix/master.cf | ssh '$TARGET_HOST' 'cat > /etc/postfix/master.cf'"
run_on_pve "pct exec '$SOURCE_CT_ID' -- cat /etc/postfix/pgsql-department-mailboxes.cf | ssh '$TARGET_HOST' 'cat > /etc/postfix/pgsql-department-mailboxes.cf'"
run_on_pve "pct exec '$SOURCE_CT_ID' -- tar -C /etc/postfix -cf - sql virtual virtual.db | ssh '$TARGET_HOST' 'tar -C /etc/postfix -xf -'"

run_on_pve "pct exec '$SOURCE_CT_ID' -- cat /etc/dovecot/dovecot.conf | ssh '$TARGET_HOST' 'cat > /etc/dovecot/dovecot.conf'"
run_on_pve "pct exec '$SOURCE_CT_ID' -- cat /etc/dovecot/dovecot-sql.conf.ext | ssh '$TARGET_HOST' 'cat > /etc/dovecot/dovecot-sql.conf.ext'"
run_on_pve "pct exec '$SOURCE_CT_ID' -- cat /etc/dovecot/conf.d/10-auth.conf | ssh '$TARGET_HOST' 'cat > /etc/dovecot/conf.d/10-auth.conf'"
run_on_pve "pct exec '$SOURCE_CT_ID' -- cat /etc/dovecot/conf.d/10-mail.conf | ssh '$TARGET_HOST' 'cat > /etc/dovecot/conf.d/10-mail.conf'"
run_on_pve "pct exec '$SOURCE_CT_ID' -- cat /etc/dovecot/conf.d/10-master.conf | ssh '$TARGET_HOST' 'cat > /etc/dovecot/conf.d/10-master.conf'"
run_on_pve "pct exec '$SOURCE_CT_ID' -- cat /etc/dovecot/conf.d/10-ssl.conf | ssh '$TARGET_HOST' 'cat > /etc/dovecot/conf.d/10-ssl.conf'"
run_on_pve "pct exec '$SOURCE_CT_ID' -- cat /etc/dovecot/conf.d/auth-sql.conf.ext | ssh '$TARGET_HOST' 'cat > /etc/dovecot/conf.d/auth-sql.conf.ext'"
run_on_pve "pct exec '$SOURCE_CT_ID' -- cat /etc/dovecot/conf.d/99-migra-hardening.conf | ssh '$TARGET_HOST' 'cat > /etc/dovecot/conf.d/99-migra-hardening.conf'"

run_on_pve "pct exec '$SOURCE_CT_ID' -- cat /etc/default/opendkim | ssh '$TARGET_HOST' 'cat > /etc/default/opendkim'"
run_on_pve "pct exec '$SOURCE_CT_ID' -- cat /etc/opendkim.conf | ssh '$TARGET_HOST' 'cat > /etc/opendkim.conf'"
run_on_pve "pct exec '$SOURCE_CT_ID' -- tar -C /etc -cf - opendkim | ssh '$TARGET_HOST' 'tar -C /etc -xf -'"

echo "[6/8] Syncing active TLS material"
run_on_pve "pct exec '$SOURCE_CT_ID' -- tar -C /etc/letsencrypt -cf - archive/mail.migrahosting.com live/mail.migrahosting.com | ssh '$TARGET_HOST' 'tar -C /etc/letsencrypt -xf -'"
run_on_pve "pct exec '$SOURCE_CT_ID' -- tar -C /etc/letsencrypt -cf - archive/mail.migrateck.com live/mail.migrateck.com | ssh '$TARGET_HOST' 'tar -C /etc/letsencrypt -xf -' || true"

echo "[7/8] Fixing ownership and validating config"
run_on_pve "ssh '$TARGET_HOST' '
  chown -R vmail:vmail /home/vmail /var/vmail
  chown -R opendkim:opendkim /etc/opendkim
  chmod 600 /etc/opendkim/keys/*/*.private 2>/dev/null || true
  chmod 600 /etc/opendkim/keys/*.private 2>/dev/null || true
  postmap /etc/postfix/virtual || true
  postfix check
  doveconf -n >/tmp/doveconf.out
'"

echo "[8/8] Starting services"
run_on_pve "ssh '$TARGET_HOST' '
  systemctl enable postfix dovecot opendkim
  systemctl restart opendkim
  systemctl restart dovecot
  systemctl restart postfix
  systemctl restart postfix@- || true
'"

echo "Mail-core restore complete"
