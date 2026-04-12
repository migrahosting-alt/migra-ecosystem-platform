# Quick Reference - Emergency Procedures

## Tailscale All Offline (VMs Running)

**Symptoms:**
- All Tailscale nodes offline except pve
- VMs are running but unreachable

**Quick Fix:**
```bash
# 1. Check FORWARD policy on pve
ssh root@100.73.199.109 "iptables -L FORWARD -n | head -3"

# 2. If policy is DROP, fix it:
ssh root@100.73.199.109 "ufw default allow forward && ufw reload"

# 3. Verify
ssh root@100.73.199.109 "bash /root/verify-firewall.sh"

# 4. If still offline, restart Tailscale on VMs:
ssh root@100.73.199.109 "for ip in 10.1.10.10 10.1.10.102 10.1.10.206 10.1.10.210 10.1.10.101; do ssh root@\$ip 'systemctl restart tailscaled' 2>/dev/null & done; wait"
```

**Root Cause:** UFW FORWARD chain blocking VM traffic to internet

**See:** [FIREWALL-CONFIG.md](./FIREWALL-CONFIG.md)

---

## VM Lost Network Config

**Symptoms:**
- VM has no IP address
- `ip addr` shows no IPv4 on eth0/ens18

**Fix for cloud-init VMs (e.g., VM 107):**
```bash
ssh root@100.73.199.109
qm set 107 --ipconfig0 ip=10.1.10.206/24,gw=10.1.10.1
qm reboot 107
```

**Fix for non-cloud-init VMs (e.g., VM 100):**
```bash
# Open Proxmox console, then:
cat > /etc/netplan/01-netcfg.yaml << 'EOF'
network:
  version: 2
  renderer: networkd
  ethernets:
    eth0:
      match:
        macaddress: "XX:XX:XX:XX:XX:XX"
      addresses: [10.1.10.X/24]
      gateway4: 10.1.10.1
      nameservers:
        addresses: [1.1.1.1, 8.8.8.8]
EOF
netplan apply
```

---

## Database Unreachable (mpanel-api errors)

**Quick Check:**
```bash
ssh root@100.73.199.109 "ssh root@10.1.10.210 'systemctl status postgresql'"
```

**If db-core VM has no network:** See "VM Lost Network Config" above

**If PostgreSQL not running:**
```bash
ssh root@100.73.199.109 "ssh root@10.1.10.210 'systemctl start postgresql'"
```

---

## Verify All Systems Healthy

```bash
# Run verification script
ssh root@100.73.199.109 "bash /root/verify-firewall.sh"

# Check Tailscale mesh
ssh root@100.73.199.109 "tailscale status"

# Check all VMs running
ssh root@100.73.199.109 "qm list | grep running"

# Test internal network
ssh root@100.73.199.109 "nmap -sn 10.1.10.0/24 | grep -c 'Host is up'"
```

---

## Scripts on pve

Located in `/root/` on pve (100.73.199.109):

- `verify-firewall.sh` - Check firewall health
- `restore-firewall.sh` - Restore correct UFW config
- `ufw-config-backup.txt` - Last known good config

**Automated monitoring:** `/etc/cron.hourly/check-firewall` logs to syslog if FORWARD policy breaks
