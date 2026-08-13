#!/usr/bin/env bash
# READ-ONLY. Establishes which guest IDs and which 10.10.0.0/24 addresses are
# already in use, so the VM ID and IP are chosen from evidence rather than guessed.
set -uo pipefail

echo "=== guest IDs in use (VMs then CTs) ==="
qm list 2>/dev/null | awk 'NR>1{print $1}' | sort -n | tr '\n' ' '; echo "   <- VMs"
pct list 2>/dev/null | awk 'NR>1{print $1}' | sort -n | tr '\n' ' '; echo "   <- CTs"

echo
echo "=== live neighbour table on vmbr10 (observed occupancy) ==="
ip neigh show dev vmbr10 2>/dev/null | sort -t. -k4 -n

echo
echo "=== addresses configured on vmbr10 itself ==="
ip -brief addr show vmbr10 2>/dev/null

echo
echo "=== static IPs declared in guest configs (LXC only; VMs configure inside the guest) ==="
for id in $(pct list 2>/dev/null | awk 'NR>1{print $1}'); do
  ipline=$(pct config "$id" 2>/dev/null | sed -n 's/^net[0-9]*:.*ip=\([0-9.]*\/[0-9]*\).*/\1/p')
  [ -n "$ipline" ] && printf 'CT %-5s %-22s %s\n' "$id" "$(pct config "$id" | sed -n 's/^hostname: //p')" "$ipline"
done

echo
echo "=== any DHCP reservations / static leases on the host ==="
ls -1 /etc/dnsmasq.d/ 2>/dev/null | head -5 || echo "(no dnsmasq.d)"
grep -rhoE '10\.10\.0\.[0-9]+' /etc/network/interfaces /etc/network/interfaces.d/ 2>/dev/null | sort -t. -k4 -n | uniq -c

echo
echo "NOTE: QEMU VMs set their addresses inside the guest, so the neighbour table"
echo "above is the best host-side evidence. Confirm any candidate address is"
echo "unused before assigning it."
