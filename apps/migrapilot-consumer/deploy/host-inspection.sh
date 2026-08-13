#!/usr/bin/env bash
### MigraPilot Brain — host inspection  (READ-ONLY. Changes nothing.)
###
### Run on the host that will run Brain, BEFORE any install decision.
### Every question the deployment template leaves as a «PLACEHOLDER» is
### answered here. Nothing is assumed: not the distro, not the init system,
### not the firewall, not nginx, not the paths, not the service account.
###
###   bash host-inspection.sh > brain-host-facts.txt 2>&1
###
### Paste the output back. Only after these facts are known should any
### root-level install command be considered.

set -uo pipefail
section() { printf '\n════════ %s ════════\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

section "0 · identity of this host"
hostname -f 2>/dev/null || hostname
id
date -Is

section "1 · OS / distribution / kernel"
cat /etc/os-release 2>/dev/null | head -8
uname -srm

section "2 · init system (is systemd even in use?)"
if have systemctl && [ -d /run/systemd/system ]; then
  echo "systemd: ACTIVE"
  systemctl --version | head -1
else
  echo "systemd: NOT DETECTED — the .service template does not apply; report what is used"
  ps -p 1 -o comm= 2>/dev/null
fi

section "3 · does Brain already exist here?"
if have systemctl; then
  systemctl list-units --type=service --all 2>/dev/null | grep -iE 'brain|migrapilot' || echo "no brain/migrapilot unit found"
fi
ls -la /etc/systemd/system/ 2>/dev/null | grep -iE 'brain|migrapilot' || echo "no brain unit file in /etc/systemd/system"
pgrep -af 'dist/src/server.js|brain-service' 2>/dev/null || echo "no running brain process"

section "4 · is port 3988 already in use?"
if have ss; then ss -lntp 2>/dev/null | grep -E ':3988|LISTEN' | head -20
elif have netstat; then netstat -lntp 2>/dev/null | head -20
else echo "neither ss nor netstat available"; fi

section "5 · listening sockets — what is exposed beyond loopback?"
if have ss; then
  echo "--- non-loopback listeners (candidates for unintended exposure) ---"
  ss -lntH 2>/dev/null | awk '{print $4}' | grep -vE '^127\.|^\[::1\]|^\[?::1' | sort -u | head -20
fi

section "6 · network interfaces / private addresses"
if have ip; then ip -brief addr 2>/dev/null; else ifconfig -a 2>/dev/null | head -30; fi

section "7 · firewall framework in use"
for fw in ufw firewall-cmd nft iptables; do
  if have "$fw"; then echo "present: $fw"; fi
done
have ufw && { echo "--- ufw status ---"; ufw status verbose 2>/dev/null | head -20; }
have firewall-cmd && { echo "--- firewalld ---"; firewall-cmd --state 2>/dev/null; }
have nft && { echo "--- nftables ruleset (head) ---"; nft list ruleset 2>/dev/null | head -25; }
have iptables && { echo "--- iptables filter (head) ---"; iptables -S 2>/dev/null | head -25; }
echo "(root may be required for full firewall output; note if truncated)"

section "8 · candidate service account"
for u in brain brain-service migrapilot nodeapp; do
  id "$u" >/dev/null 2>&1 && echo "EXISTS: $u -> $(id "$u")"
done
echo "--- existing non-system service accounts (uid >= 1000) ---"
awk -F: '$3>=1000 && $3<65534 {print $1" uid="$3" shell="$7}' /etc/passwd 2>/dev/null | head -15

section "9 · Node.js runtime"
have node && echo "node: $(node -v) at $(command -v node)" || echo "node: NOT INSTALLED"
have npm && echo "npm: $(npm -v)" || echo "npm: NOT INSTALLED"
echo "(brain-service package.json declares no engines field; confirm the runtime is >= the version used to build)"

section "10 · storage: where could app/data/backups live?"
df -hPT / /var /opt /srv /home 2>/dev/null | awk 'NR==1 || !seen[$1]++'
echo "--- existing candidate directories ---"
for d in /opt /srv /var/lib /var/log; do [ -d "$d" ] && echo "$d exists ($(stat -c '%U:%G %a' "$d" 2>/dev/null))"; done

section "11 · current ingress (is anything already fronting this host?)"
have nginx && { echo "nginx: $(nginx -v 2>&1)"; echo "(run 'sudo nginx -T' separately for the RUNNING config)"; } || echo "nginx: not installed"
ls -la /etc/nginx/sites-enabled/ 2>/dev/null | head -20 || echo "no /etc/nginx/sites-enabled"
echo "--- any vhost mentioning brain or 3988 (should be NONE) ---"
grep -rl -e 'brain' -e '3988' /etc/nginx/ 2>/dev/null | head -10 || echo "none — correct, Brain must not be fronted publicly"

section "12 · reachability FROM here to the consumer tier (informational)"
echo "Record where the consumer Next.js server will run. If it is this host,"
echo "Brain binds 127.0.0.1. If it is another host, a private-interface bind"
echo "plus a firewall allow-rule scoped to that host's address is required."

section "DONE"
echo "Nothing was modified. Paste this output back before any install step."
