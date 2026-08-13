#!/usr/bin/env bash
# READ-ONLY. Establishes the true current state of guests and the backup job
# before any edit to /etc/pve/jobs.cfg (shared cluster configuration).
set -uo pipefail

echo "=== containers currently defined ==="
pct list

echo
echo "=== VMs currently defined ==="
qm list

echo
echo "=== specific IDs of interest ==="
for id in 100 120 122 111; do
  printf '%-5s ' "$id"
  if qm config "$id" >/dev/null 2>&1; then echo "exists as VM"
  elif pct config "$id" >/dev/null 2>&1; then echo "exists as CT"
  else echo "DOES NOT EXIST"
  fi
done

echo
echo "=== backup job vmid list (authoritative, from API) ==="
pvesh get /cluster/backup/migra-nightly --output-format json 2>/dev/null \
  | tr ',' '\n' | grep -i vmid

echo
echo "=== is 111 already in the job? ==="
if pvesh get /cluster/backup/migra-nightly --output-format json 2>/dev/null | grep -qE '(^|,|")111(,|"|$)'; then
  echo "YES — already present"
else
  echo "NO — would need adding"
fi
