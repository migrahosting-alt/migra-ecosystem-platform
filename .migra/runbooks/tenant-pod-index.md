# Tenant / Pod Index (Best-Effort)

This maps internal target IPs observed in NGINX proxy_pass to Proxmox CTs when possible.

## 10.1.10.104
- Seen in proxy_pass: http://10.1.10.104:80
- CT: 137 hostname=pod-cc6887da
  - lo               UNKNOWN        127.0.0.1/8 ::1/128
  - eth0@if6         UP             127.0.0.127/32 10.1.10.104/24 2603:3020:a5d:4600::ca1c/128 2603:3020:a5d:4600:be24:11ff:fe8b:98c1/64 fe80::be24:11ff:fe8b:98c1/64
- CT: 9099 hostname=cloudpod-template-backup
  - lo               UNKNOWN        127.0.0.1/8 ::1/128
  - eth0@if9         UP             127.0.0.127/32 10.1.10.104/24 2603:3020:a5d:4600::6264/128 2603:3020:a5d:4600:be24:11ff:fe18:444/64 fe80::be24:11ff:fe18:444/64

## 10.1.10.206
- Seen in proxy_pass: http://10.1.10.206:2271
- CT: (not found in LXC scan; likely VM or external)

## 10.1.10.53
- Seen in proxy_pass: http://10.1.10.53:80
- CT: 139 hostname=pod-lituationdjs
  - lo               UNKNOWN        127.0.0.1/8 ::1/128
  - eth0@if47        UP             10.1.10.53/24 2603:3020:a5d:4600::47f5/128 2603:3020:a5d:4600:be24:11ff:fe20:5e4f/64 fe80::be24:11ff:fe20:5e4f/64

## 100.107.92.101
- Seen in proxy_pass: http://100.107.92.101:9001
- CT: (not found in LXC scan; likely VM or external)

## 100.64.119.23
- Seen in proxy_pass: http://100.64.119.23:3010
- CT: (not found in LXC scan; likely VM or external)

## 100.65.164.127
- Seen in proxy_pass: http://100.65.164.127:9000
- CT: (not found in LXC scan; likely VM or external)

## 100.97.213.11
- Seen in proxy_pass: http://100.97.213.11:2271
- CT: (not found in LXC scan; likely VM or external)

## 127.0.0.1
- Seen in proxy_pass: http://127.0.0.1:3003/
- CT: 136 hostname=pod-elizefoundation
  - lo               UNKNOWN        127.0.0.1/8 ::1/128
  - eth0@if45        UP             10.1.10.51/24 2603:3020:a5d:4600::598/128 2603:3020:a5d:4600:be24:11ff:feba:584/64 fe80::be24:11ff:feba:584/64
- CT: 137 hostname=pod-cc6887da
  - lo               UNKNOWN        127.0.0.1/8 ::1/128
  - eth0@if6         UP             127.0.0.127/32 10.1.10.104/24 2603:3020:a5d:4600::ca1c/128 2603:3020:a5d:4600:be24:11ff:fe8b:98c1/64 fe80::be24:11ff:fe8b:98c1/64
- CT: 138 hostname=pod-holisticgroupllc
  - lo               UNKNOWN        127.0.0.1/8 ::1/128
  - eth0@if46        UP             10.1.10.52/24 2603:3020:a5d:4600::c66f/128 2603:3020:a5d:4600:be24:11ff:feaa:7a0a/64 fe80::be24:11ff:feaa:7a0a/64
- CT: 139 hostname=pod-lituationdjs
  - lo               UNKNOWN        127.0.0.1/8 ::1/128
  - eth0@if47        UP             10.1.10.53/24 2603:3020:a5d:4600::47f5/128 2603:3020:a5d:4600:be24:11ff:fe20:5e4f/64 fe80::be24:11ff:fe20:5e4f/64
- CT: 9099 hostname=cloudpod-template-backup
  - lo               UNKNOWN        127.0.0.1/8 ::1/128
  - eth0@if9         UP             127.0.0.127/32 10.1.10.104/24 2603:3020:a5d:4600::6264/128 2603:3020:a5d:4600:be24:11ff:fe18:444/64 fe80::be24:11ff:fe18:444/64

## 10.1.10.240
- Seen in proxy_pass: https://10.1.10.240
- CT: (not found in LXC scan; likely VM or external)

## 10.1.10.70
- Seen in proxy_pass: https://10.1.10.70:8006
- CT: (not found in LXC scan; likely VM or external)

## lituationdjs.com
- Domain: lituationdjs.com
- proxy_pass: http://10.1.10.53:80
- Owner: pve CT 139 (pod-lituationdjs)
