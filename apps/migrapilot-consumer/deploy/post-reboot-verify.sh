#!/usr/bin/env bash
# Post-reboot health verification for migrapilot-app-core. Read-only.
set -uo pipefail

echo "=== identity / kernel ==="
hostname
uname -r
uptime -p

echo
echo "=== network ==="
hostname -I
ip route | head -3

echo
echo "=== tailscale daemon (client installed, enrolment separate) ==="
systemctl is-enabled tailscaled 2>/dev/null
systemctl is-active tailscaled 2>/dev/null
tailscale status 2>&1 | head -3

echo
echo "=== guest agent ==="
systemctl is-active qemu-guest-agent 2>/dev/null

echo
echo "=== node ==="
node -v; npm -v

echo
echo "=== service identities survived reboot ==="
for u in migrapilot-brain migrapilot-consumer; do
  id "$u" >/dev/null 2>&1 && echo "ok   $u" || echo "MISSING $u"
done

echo
echo "=== filesystem layout + modes ==="
for p in /opt/migrapilot/brain-service/releases /opt/migrapilot/consumer/releases \
         /var/lib/migrapilot/brain /etc/migrapilot /var/backups/migrapilot; do
  printf '%-45s %s\n' "$p" "$(stat -c '%U:%G %a' "$p" 2>/dev/null || echo MISSING)"
done

echo
echo "=== isolation still holds after reboot ==="
if sudo -u migrapilot-consumer test -r /var/lib/migrapilot/brain 2>/dev/null; then
  echo "FAIL consumer can read Brain state"
else
  echo "ok   consumer denied Brain state"
fi

echo
echo "=== disk ==="
df -hT / | tail -1

echo
echo "=== pending reboot still flagged? ==="
[ -f /var/run/reboot-required ] && cat /var/run/reboot-required || echo "none — kernel current"

echo
echo "=== listeners (expect only :22 plus loopback DNS) ==="
ss -lntu | grep -v "127.0.0" | head -6
