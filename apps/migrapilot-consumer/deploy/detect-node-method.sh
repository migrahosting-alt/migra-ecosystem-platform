#!/usr/bin/env bash
# READ-ONLY. Establishes how Node.js was installed on an existing ecosystem
# guest, so the new host follows the same approved method rather than a guess.
set -uo pipefail

echo "host: $(hostname)"
echo -n "node: "; command -v node >/dev/null 2>&1 && node -v || echo "not installed"
echo -n "npm : "; command -v npm  >/dev/null 2>&1 && npm -v  || echo "not installed"
echo -n "path: "; command -v node 2>/dev/null || true

echo
echo "=== apt source lists mentioning node ==="
grep -rl -i node /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null | head -5
grep -rh -i "nodesource\|deb.nodesource" /etc/apt/sources.list.d/ 2>/dev/null | head -5

echo
echo "=== apt package origin ==="
dpkg -l nodejs 2>/dev/null | awk '/^ii/{print "dpkg nodejs version: "$3}'
apt-cache policy nodejs 2>/dev/null | head -8

echo
echo "=== alternative managers present? ==="
for m in nvm fnm volta asdf; do
  command -v "$m" >/dev/null 2>&1 && echo "$m: present"
done
[ -d "$HOME/.nvm" ] && echo ".nvm directory present" || true
ls -d /usr/local/n 2>/dev/null && echo "n (node version manager) present" || true
