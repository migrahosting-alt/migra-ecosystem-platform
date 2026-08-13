#!/usr/bin/env bash
### migrapilot-app-core — Node 22, service identities, filesystem layout.
###
### Guest-local only. Installs NO application code and creates NO application
### systemd units. Idempotent: safe to re-run.
###
### Node is installed from the NodeSource apt repository, matching the method
### already in use on CT 101 (`/etc/apt/sources.list.d/nodesource.sources`,
### keyring at /usr/share/keyrings/nodesource.gpg).
set -euo pipefail

BRAIN_USER=migrapilot-brain
CONSUMER_USER=migrapilot-consumer

echo "════════ 1 · Node 22 (NodeSource, ecosystem-approved method) ════════"
if command -v node >/dev/null 2>&1 && node -v | grep -q '^v22\.'; then
  echo "Node 22 already present: $(node -v)"
else
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "node: $(node -v)   npm: $(npm -v)"

echo
echo "════════ 2 · service identities (system accounts, no login) ════════"
for u in "$BRAIN_USER" "$CONSUMER_USER"; do
  if id "$u" >/dev/null 2>&1; then
    echo "exists: $u"
  else
    sudo useradd --system --no-create-home --home-dir /nonexistent \
                 --shell /usr/sbin/nologin "$u"
    echo "created: $u"
  fi
done

echo
echo "════════ 3 · filesystem layout ════════"
# Parent directories are root-owned and world-traversable so each service can
# reach its own subtree — and only its own.
sudo install -d -o root -g root -m 0755 /opt/migrapilot
sudo install -d -o root -g root -m 0755 /opt/migrapilot/brain-service
sudo install -d -o root -g root -m 0755 /opt/migrapilot/consumer
sudo install -d -o root -g root -m 0755 /var/lib/migrapilot
sudo install -d -o root -g root -m 0755 /etc/migrapilot

# Release trees: readable/executable by the owning service, writable by NEITHER
# service account. Deployment is a root-controlled action, which is what makes
# a release tree immutable from the running process's point of view.
sudo install -d -o root -g "$BRAIN_USER"    -m 0750 /opt/migrapilot/brain-service/releases
sudo install -d -o root -g "$CONSUMER_USER" -m 0750 /opt/migrapilot/consumer/releases

# Brain state: owned by Brain, 0750. The consumer account has no path to these
# files, so compromising the internet-facing process does not yield the SQLite
# database — an attacker must still go through the loopback API.
sudo install -d -o "$BRAIN_USER" -g "$BRAIN_USER" -m 0750 /var/lib/migrapilot/brain

# Backups: root-only.
sudo install -d -o root -g root -m 0750 /var/backups/migrapilot

echo "layout created."

echo
echo "════════ 4 · resulting ownership and modes ════════"
for p in /opt/migrapilot /opt/migrapilot/brain-service/releases \
         /opt/migrapilot/consumer/releases /var/lib/migrapilot \
         /var/lib/migrapilot/brain /etc/migrapilot /var/backups/migrapilot; do
  printf '%-45s %s\n' "$p" "$(stat -c '%U:%G %a' "$p")"
done

echo
echo "════════ 5 · ISOLATION PROOF (negative tests) ════════"
fail=0

check() { # description, expectation(allow|deny), command...
  local desc="$1" expect="$2"; shift 2
  if sudo "$@" >/dev/null 2>&1; then actual=allow; else actual=deny; fi
  if [ "$actual" = "$expect" ]; then
    printf '  ok    %-58s %s\n' "$desc" "$actual"
  else
    printf '  FAIL  %-58s expected=%s actual=%s\n' "$desc" "$expect" "$actual"; fail=1
  fi
}

check "brain CAN read its own state dir"        allow -u "$BRAIN_USER"    test -r /var/lib/migrapilot/brain
check "brain CAN write its own state dir"       allow -u "$BRAIN_USER"    test -w /var/lib/migrapilot/brain
check "consumer CANNOT read brain state"        deny  -u "$CONSUMER_USER" test -r /var/lib/migrapilot/brain
check "consumer CANNOT traverse brain state"    deny  -u "$CONSUMER_USER" test -x /var/lib/migrapilot/brain
check "brain CAN read its release tree"         allow -u "$BRAIN_USER"    test -r /opt/migrapilot/brain-service/releases
check "brain CANNOT write its release tree"     deny  -u "$BRAIN_USER"    test -w /opt/migrapilot/brain-service/releases
check "consumer CAN read its release tree"      allow -u "$CONSUMER_USER" test -r /opt/migrapilot/consumer/releases
check "consumer CANNOT write its release tree"  deny  -u "$CONSUMER_USER" test -w /opt/migrapilot/consumer/releases
check "consumer CANNOT read brain releases"     deny  -u "$CONSUMER_USER" test -r /opt/migrapilot/brain-service/releases
check "brain CANNOT read consumer releases"     deny  -u "$BRAIN_USER"    test -r /opt/migrapilot/consumer/releases
check "consumer CANNOT read backups"            deny  -u "$CONSUMER_USER" test -r /var/backups/migrapilot

# Stronger than a permission bit: plant a real file as Brain and prove the
# consumer cannot open it.
sudo -u "$BRAIN_USER" sh -c 'echo sentinel > /var/lib/migrapilot/brain/.perm-probe' 2>/dev/null || true
check "consumer CANNOT read an actual Brain file" deny -u "$CONSUMER_USER" cat /var/lib/migrapilot/brain/.perm-probe
sudo rm -f /var/lib/migrapilot/brain/.perm-probe

echo
if [ "$fail" -eq 0 ]; then
  echo "ALL ISOLATION CHECKS PASSED"
else
  echo "ISOLATION CHECKS FAILED — do not deploy until resolved"
fi
exit "$fail"
