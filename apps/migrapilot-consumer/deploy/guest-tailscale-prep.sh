#!/usr/bin/env bash
# Prepare the guest for Tailscale enrolment.
#
# Installs the client ONLY. Deliberately stops before `tailscale up` — that is
# the step requiring an auth key, which belongs to the operator and must not
# pass through automation, shell history, or the repository.
#
# Run on migrapilot-app-core.
set -euo pipefail

if command -v tailscale >/dev/null 2>&1; then
  echo "tailscale already installed: $(tailscale version | head -1)"
else
  echo "── installing tailscale ──"
  curl -fsSL https://tailscale.com/install.sh | sudo sh
fi

echo
echo "── client state (no enrolment performed) ──"
tailscale version | head -2
systemctl is-enabled tailscaled 2>/dev/null || true
systemctl is-active tailscaled 2>/dev/null || true

echo
echo "── enrolment status ──"
if tailscale status >/dev/null 2>&1; then
  echo "ALREADY ENROLLED:"
  tailscale status | head -5
else
  echo "NOT ENROLLED — awaiting operator-supplied auth key."
  echo
  echo "Run this yourself (key never leaves your session):"
  echo "  sudo tailscale up --auth-key=<ONE-TIME-KEY> --hostname=migrapilot-app-core"
  echo
  echo "Deliberately NOT passing: --advertise-routes, --advertise-exit-node,"
  echo "--accept-routes. Those change network posture and are separate decisions."
fi
