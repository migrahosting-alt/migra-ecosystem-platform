# SSH Access Runbook

- Primary Hetzner hypervisor:
  `ssh root@138.201.255.55`
- Preferred aliases to keep in local SSH config:
  `pve`, `nginx-proxy-core`, `cloud-core`, `db-core`, `migrapanel-core`, `mail-core`, `dns-core`, `app-core`, `voip-core`
- Current validated Tailscale IPs:
  `pve` -> `100.73.199.109`
  `nginx-proxy-core` -> `100.101.106.88`
  `cloud-core` -> `100.113.190.42`
  `db-core` -> `100.77.51.91`
  `migrapanel-core` -> `100.68.175.27`
  `mail-core` -> `100.114.228.57`
  `dns-core` -> `100.126.11.116`
  `app-core` -> `100.101.3.99`
  `voip-core` -> `100.111.4.85`
- Internal VM LAN IPs behind Hetzner Proxmox:
  `nginx-proxy-core` -> `10.10.0.2`
  `cloud-core` -> `10.10.0.3`
  `db-core` -> `10.10.0.6`
  `migrapanel-core` -> `10.10.0.7`
  `mail-core` -> `10.10.0.8`
  `dns-core` -> `10.10.0.9`
  `app-core` -> `10.10.0.10`
  `ns2-dns` -> `10.10.0.11`
- Public service anchors:
  `mail.migrahosting.com` -> `138.201.255.45`
  `ns1.migrahosting.com` -> `138.201.255.55`
  `ns2.migrahosting.com` -> `138.201.255.35`
- Safe validation commands:
  `ssh root@138.201.255.55 'hostname; pveversion'`
  `ssh root@138.201.255.55 'qm list'`
  `ssh root@138.201.255.55 'ssh root@10.10.0.8 "hostname; systemctl is-active postfix dovecot"'`
