#!/usr/bin/env bash
### Provision `migrapilot-app-core` — MigraPilot consumer + Brain host.
###
### DRY-RUN BY DEFAULT. Running this script prints the exact command sequence
### and changes nothing. Execution requires BOTH:
###
###   VMID=<id> VMIP=<addr> CONFIRM=yes bash provision-migrapilot-app-core.sh
###
### VMID and VMIP have NO defaults on purpose. They are the two values that
### must be reviewed rather than silently chosen, so the script refuses to run
### without them even in dry-run.
###
### Run on the Proxmox host (`pve`).

set -euo pipefail

# ── reviewed inputs ────────────────────────────────────────────────────────
VMID="${VMID:-}"
VMIP="${VMIP:-}"
CONFIRM="${CONFIRM:-no}"

# ── fixed specification (approved) ─────────────────────────────────────────
VMNAME="migrapilot-app-core"
CORES=3
MEMORY=6144          # MB
DISK_SIZE="60G"
STORAGE="infra-data"
BRIDGE="vmbr10"
GATEWAY="10.10.0.1"
NAMESERVER="1.1.1.1 8.8.8.8"
CLOUDIMG="/var/lib/vz/template/iso/ubuntu-24.04-server-cloudimg-amd64.img"
CIUSER="${CIUSER:-bonex}"
SSHKEYS="${SSHKEYS:-/root/.ssh/authorized_keys}"

die() { echo "ERROR: $*" >&2; exit 1; }

[ -n "$VMID" ] || die "VMID is unset. Choose from the free pool (see spec §2) and pass it explicitly."
[ -n "$VMIP" ] || die "VMIP is unset. Choose an unused 10.10.0.0/24 address and pass it explicitly."
[[ "$VMID" =~ ^[0-9]+$ ]] || die "VMID must be numeric, got: $VMID"
[[ "$VMIP" =~ ^10\.10\.0\.[0-9]+$ ]] || die "VMIP must be inside 10.10.0.0/24, got: $VMIP"

# ── preflight: refuse to collide with anything that exists ─────────────────
if [ "$CONFIRM" = "yes" ]; then
  qm status "$VMID" >/dev/null 2>&1 && die "VM $VMID already exists. Refusing."
  pct status "$VMID" >/dev/null 2>&1 && die "CT $VMID already exists. Refusing."
  qm list | awk 'NR>1{print $2}' | grep -qx "$VMNAME" && die "A VM named $VMNAME already exists. Refusing."
  pct list | awk 'NR>1{print $3}' | grep -qx "$VMNAME" && die "A CT named $VMNAME already exists. Refusing."
  ping -c1 -W1 "$VMIP" >/dev/null 2>&1 && die "$VMIP already answers ICMP. Refusing to reuse a live address."
  [ -f "$CLOUDIMG" ] || die "Cloud image not found at $CLOUDIMG"
fi

run() {
  echo "  \$ $*"
  if [ "$CONFIRM" = "yes" ]; then "$@"; fi
}

echo "════════════════════════════════════════════════════════════════"
echo " migrapilot-app-core provisioning"
echo "   VM ID      : $VMID"
echo "   IP         : $VMIP/24  gw $GATEWAY  bridge $BRIDGE"
echo "   Resources  : ${CORES} vCPU · ${MEMORY} MB · ${DISK_SIZE} on ${STORAGE}"
echo "   Mode       : $([ "$CONFIRM" = yes ] && echo 'EXECUTING' || echo 'DRY RUN — nothing will change')"
echo "════════════════════════════════════════════════════════════════"

echo
echo "── 1 · create the VM shell (matches existing *-core convention) ──"
# Deliberately NOT setting --machine/--bios: the nine existing infra VMs use
# Proxmox defaults (i440fx/SeaBIOS), and diverging without cause would make this
# host the odd one out.
run qm create "$VMID" \
  --name "$VMNAME" \
  --cores "$CORES" \
  --memory "$MEMORY" \
  --net0 "virtio,bridge=${BRIDGE},firewall=0" \
  --ostype l26 \
  --scsihw virtio-scsi-single \
  --agent enabled=1 \
  --onboot 1 \
  --description "MigraPilot consumer (Next.js) + brain-service. Brain is loopback-only on 127.0.0.1:3988 and has no public route. NOT the AnnouPale assistant — that is CT 101 migrapilot-core."

echo
echo "── 2 · import the Ubuntu 24.04 cloud image ──"
run qm importdisk "$VMID" "$CLOUDIMG" "$STORAGE"

echo
echo "── 3 · attach it as the boot disk, with discard (matches convention) ──"
run qm set "$VMID" --scsi0 "${STORAGE}:${VMID}/vm-${VMID}-disk-0.raw,discard=on"

echo
echo "── 4 · grow the disk to the specified size ──"
run qm disk resize "$VMID" scsi0 "$DISK_SIZE"

echo
echo "── 5 · cloud-init drive + serial console (required by cloud images) ──"
run qm set "$VMID" --ide2 "${STORAGE}:cloudinit"
run qm set "$VMID" --serial0 socket --vga serial0
run qm set "$VMID" --boot order=scsi0

echo
echo "── 6 · network and identity via cloud-init ──"
run qm set "$VMID" --ipconfig0 "ip=${VMIP}/24,gw=${GATEWAY}"
run qm set "$VMID" --nameserver "$NAMESERVER"
run qm set "$VMID" --ciuser "$CIUSER"
run qm set "$VMID" --sshkeys "$SSHKEYS"

echo
echo "── 7 · verify configuration BEFORE first boot ──"
run qm config "$VMID"

echo
echo "════════════════════════════════════════════════════════════════"
if [ "$CONFIRM" = "yes" ]; then
  echo " Created. NOT started — start deliberately after reviewing config:"
else
  echo " DRY RUN complete. Nothing was created."
  echo " To execute:  VMID=$VMID VMIP=$VMIP CONFIRM=yes bash $0"
fi
cat <<EOF

 Remaining steps, each reviewed separately (NOT automated here):

   qm start $VMID                      # first boot
   # then, from the guest: verify IP, apt update, install Node 22

   # Add to the nightly PBS backup job — edit the vmid list in:
   #   /etc/pve/jobs.cfg   job: vzdump migra-nightly
   # Current list: 100,101,102,103,104,106,107,108,109,110,503,504,505,506,507,511,512,9001
   # This is a change to shared cluster config — review before editing.

   # Tailscale enrolment, service accounts, directory layout, and application
   # install all follow the sequence in deploy/README.md.
EOF
