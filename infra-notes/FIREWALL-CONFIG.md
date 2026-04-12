# Firewall Configuration - Critical Notes

## The Problem (January 2026)

UFW was configured on pve (Proxmox hypervisor) but only the INPUT chain was configured properly. The FORWARD chain had `policy DROP`, which blocked all VM traffic to the internet, breaking:
- DNS resolution from VMs
- Tailscale connectivity (VMs couldn't reach controlplane.tailscale.com)
- All outbound internet access from VMs

**Symptoms:**
- All Tailscale nodes offline except pve
- VMs running but unreachable via Tailscale
- DNS queries from VMs timing out
- VMs could ping internal IPs but not internet

## Critical Understanding: UFW on Hypervisors

When UFW is installed on a **hypervisor** (Proxmox/KVM), you need THREE policies:
1. **INPUT** - Traffic destined TO the hypervisor itself
2. **OUTPUT** - Traffic FROM the hypervisor itself
3. **FORWARD** - Traffic THROUGH the hypervisor (VM ↔ Internet) ⚠️ **CRITICAL**

The FORWARD chain handles all VM traffic going to/from the internet through the hypervisor's bridge (vmbr0).

## Correct UFW Configuration for pve

```bash
# Default policies
ufw default deny incoming    # Block incoming to pve itself
ufw default allow outgoing    # Allow pve to reach internet
ufw default allow forward     # ⚠️ CRITICAL: Allow VM traffic through pve

# Allow Tailscale mesh
ufw allow 41641/udp

# Allow SSH from internal network
ufw allow from 10.1.10.0/24 to any port 22 proto tcp

# Allow hosting-agent from internal network
ufw allow from 10.1.10.0/24 to any port 4080 proto tcp

# Enable firewall
ufw enable
```

## Verification Script

Created at: `/root/verify-firewall.sh` on pve

Run this after any UFW changes:
```bash
ssh root@100.73.199.109 "bash /root/verify-firewall.sh"
```

## Manual Verification Commands

```bash
# Check UFW status and policies
ufw status verbose

# Check iptables FORWARD chain (should show ACCEPT)
iptables -L FORWARD -n -v | head -3

# Test VM internet connectivity
ssh root@10.1.10.102 'ping -c 2 8.8.8.8'

# Test VM DNS resolution
ssh root@10.1.10.102 'nslookup google.com 8.8.8.8'

# Check Tailscale status from pve
tailscale status
```

## Recovery Procedure

If VMs lose internet connectivity:

1. **Check FORWARD policy on pve:**
   ```bash
   ssh root@100.73.199.109 "iptables -L FORWARD -n -v | head -3"
   ```
   If you see `policy DROP`, run:
   ```bash
   ssh root@100.73.199.109 "ufw default allow forward && ufw reload"
   ```

2. **Verify VM DNS works:**
   ```bash
   ssh root@100.73.199.109 "ssh root@10.1.10.102 'dig @8.8.8.8 google.com +short'"
   ```

3. **Restart Tailscale on VMs:**
   ```bash
   ssh root@100.73.199.109 "for ip in 10.1.10.10 10.1.10.102 10.1.10.206 10.1.10.210 10.1.10.101; do ssh root@\$ip 'systemctl restart tailscaled'; done"
   ```

4. **Verify all nodes online:**
   ```bash
   ssh root@100.73.199.109 "tailscale status"
   ```

## Prevention

1. **Never modify UFW on pve without checking all three chains** (INPUT, OUTPUT, FORWARD)
2. **Always test VM connectivity** after firewall changes
3. **Run verification script** after any UFW modifications
4. **Document any changes** in this file

## Related Files

- `/root/verify-firewall.sh` - Automated verification script on pve
- `/etc/ufw/before.rules` - UFW pre-rules (if customized)
- `.github/copilot-instructions.md` - Main Copilot instructions

## Last Incident

**Date:** January 19, 2026  
**Duration:** ~1 hour  
**Resolution:** `ufw default allow forward && ufw reload`  
**Affected:** All VMs (Tailscale connectivity lost)
