#!/usr/bin/env bash
### Proxmox discovery for the MigraPilot VM  (READ-ONLY. Creates nothing.)
###
### Every command below is a query. There is no `qm create`, no `qm set`, no
### `pvesm alloc`, no write of any kind. Run it on the Proxmox host:
###
###   ssh pve 'bash -s' < deploy/proxmox-discovery.sh > pve-facts.txt 2>&1
###
### or copy it over and run locally. Paste the output back; it answers the ten
### unresolved facts in VM_PROVISIONING_SPEC.md §6, after which bounded
### VM-create commands can be generated against real values.
###
### Some queries need root on Proxmox. If run unprivileged, sections will be
### empty — note that rather than assuming the answer is "none".

set -uo pipefail
section() { printf '\n════════ %s ════════\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

section "0 · identity"
hostname -f 2>/dev/null || hostname
id
date -Is

section "1 · Proxmox version"
have pveversion && pveversion --verbose 2>/dev/null | head -12 || echo "pveversion not found — is this actually a Proxmox host?"

section "2 · cluster state / node names"
if have pvecm; then
  pvecm status 2>/dev/null | head -20 || echo "not clustered (single node) or requires root"
  echo "--- nodes ---"
  pvecm nodes 2>/dev/null || true
else
  echo "pvecm unavailable"
fi
have pvesh && pvesh get /nodes --output-format json 2>/dev/null | head -c 800 || true

section "3 · existing VMs (IDs, names, status) — reveals the ID convention"
have qm && qm list 2>/dev/null || echo "qm unavailable or requires root"

section "4 · existing containers"
have pct && pct list 2>/dev/null || echo "pct unavailable or no containers"

section "5 · storage pools, types, capacity"
have pvesm && { pvesm status 2>/dev/null; echo "--- content types ---"; pvesm status --content images 2>/dev/null; } || echo "pvesm unavailable"
echo "--- filesystem view ---"
df -hPT 2>/dev/null | head -15

section "6 · network bridges and VLAN awareness"
if have ip; then ip -brief addr 2>/dev/null | head -20; fi
echo "--- /etc/network/interfaces ---"
cat /etc/network/interfaces 2>/dev/null | head -40 || echo "(unreadable without root)"
echo "--- bridges present ---"
ls -1 /sys/class/net/ 2>/dev/null | grep -E '^vmbr' || echo "no vmbr* bridges visible"
for b in /sys/class/net/vmbr*; do
  [ -e "$b" ] || continue
  echo "$(basename "$b") vlan_filtering=$(cat "$b/bridge/vlan_filtering" 2>/dev/null || echo '?')"
done

section "7 · available templates / cloud images"
have pvesm && pvesm list local --content vztmpl 2>/dev/null | head -15 || true
echo "--- ISO images ---"
have pvesm && pvesm list local --content iso 2>/dev/null | head -15 || true
echo "--- common image paths ---"
ls -1 /var/lib/vz/template/iso/ 2>/dev/null | head -10 || echo "(none or unreadable)"
ls -1 /var/lib/vz/template/cache/ 2>/dev/null | head -10 || echo "(none or unreadable)"

section "8 · host capacity headroom"
echo "--- CPU ---"; lscpu 2>/dev/null | grep -E '^(CPU\(s\)|Model name|Thread|Core|Socket)' | head -6
echo "--- memory ---"; free -h 2>/dev/null
echo "--- current VM resource commitments ---"
if have qm; then
  for id in $(qm list 2>/dev/null | awk 'NR>1{print $1}'); do
    printf '%s ' "$id"; qm config "$id" 2>/dev/null | grep -E '^(name|cores|memory|scsi0|net0|onboot|agent):' | tr '\n' ' '; echo
  done
fi

section "9 · backup configuration"
cat /etc/pve/jobs.cfg 2>/dev/null | head -25 || echo "(no jobs.cfg or requires root)"
have pvesm && pvesm status --content backup 2>/dev/null || true

section "10 · naming / tagging conventions in use"
if have qm; then
  echo "--- names and tags ---"
  for id in $(qm list 2>/dev/null | awk 'NR>1{print $1}'); do
    printf '%-6s %-24s tags=%s\n' "$id" \
      "$(qm config "$id" 2>/dev/null | sed -n 's/^name: //p')" \
      "$(qm config "$id" 2>/dev/null | sed -n 's/^tags: //p')"
  done
fi

section "DONE"
echo "Nothing was created or modified. Paste this output back before any provisioning step."
