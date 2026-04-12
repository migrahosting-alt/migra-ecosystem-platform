# NGINX Routing Map

## Control Panel Notes (2026-01-21)
- migrapanel.com is now served by migrapanel-core (100.119.105.93:3020).
- mpanel.migrahosting.com and panel.migrahosting.com are deprecated and should not be treated as active control panel targets.

Generated from `.migra/nginx.routing.map.json` (parsed from `nginx -T` + hints).

## MigraDrive Note (2026-04-01)
- Active storage ingress should be treated as a single canonical gateway at `https://10.1.10.240`.
- `https://migradrive.com` should remain the only human-facing MigraDrive URL.
- `s3.migradrive.com`, `console.migradrive.com`, `mb.migrahosting.com`, `console.mb.migrahosting.com`, `migradrive.migrahosting.com`, and `console.migradrive.migrahosting.com` should not drift to different proxy targets.

## Targets → Domains

### http://10.1.10.104:80
- Owner: CT 137 (pod-cc6887da)
- Owner: CT 9099 (cloudpod-template-backup)
- premtint.com
- www.premtint.com

### http://10.1.10.206:3020
- Owner: (not found in LXC iphost scan; likely VM or external) ip=10.1.10.206
- panel.migrahosting.com (deprecated)

### http://10.1.10.53:80
- Owner: CT 139 (pod-lituationdjs)
- lituationdjs.com
- www.lituationdjs.com

### http://100.107.92.101:9001
- Owner: (not found in LXC iphost scan; likely VM or external) ip=100.107.92.101
- console.mb.migrahosting.com

### http://100.64.119.23:3010
- Owner: (not found in LXC iphost scan; likely VM or external) ip=100.64.119.23
- mail.migrahosting.com
- migramail.com

### http://100.65.164.127:9000
- Owner: (not found in LXC iphost scan; likely VM or external) ip=100.65.164.127
- mb.migrahosting.com

### http://100.119.105.93:3020
- Owner: (not found in LXC iphost scan; likely VM or external) ip=100.119.105.93
- mpanel.migrahosting.com (deprecated)

### http://127.0.0.1:3003/
- Owner: CT 136 (pod-elizefoundation)
- Owner: CT 137 (pod-cc6887da)
- Owner: CT 138 (pod-holisticgroupllc)
- Owner: CT 139 (pod-lituationdjs)
- Owner: CT 9099 (cloudpod-template-backup)
- voice.migrahosting.com

### http://127.0.0.1:3003/widgets/
- Owner: CT 136 (pod-elizefoundation)
- Owner: CT 137 (pod-cc6887da)
- Owner: CT 138 (pod-holisticgroupllc)
- Owner: CT 139 (pod-lituationdjs)
- Owner: CT 9099 (cloudpod-template-backup)
- voice.migrahosting.com

### http://127.0.0.1:3003/ws/admin
- Owner: CT 136 (pod-elizefoundation)
- Owner: CT 137 (pod-cc6887da)
- Owner: CT 138 (pod-holisticgroupllc)
- Owner: CT 139 (pod-lituationdjs)
- Owner: CT 9099 (cloudpod-template-backup)
- voice.migrahosting.com

### http://127.0.0.1:4000
- Owner: CT 136 (pod-elizefoundation)
- Owner: CT 137 (pod-cc6887da)
- Owner: CT 138 (pod-holisticgroupllc)
- Owner: CT 139 (pod-lituationdjs)
- Owner: CT 9099 (cloudpod-template-backup)
- intake.migrahosting.com

### http://127.0.0.1:4242
- Owner: CT 136 (pod-elizefoundation)
- Owner: CT 137 (pod-cc6887da)
- Owner: CT 138 (pod-holisticgroupllc)
- Owner: CT 139 (pod-lituationdjs)
- Owner: CT 9099 (cloudpod-template-backup)
- migrahosting.com
- www.migrahosting.com

### http://127.0.0.1:4300
- Owner: srv1-web local service (`migra-market.service`)
- marketing.migrahosting.com

### https://10.1.10.240
- Owner: (not found in LXC iphost scan; likely VM or external) ip=10.1.10.240
- console.migradrive.com
- console.migradrive.migrahosting.com
- migradrive.migrahosting.com
- s3.migradrive.com

### https://10.1.10.70:8006
- Owner: (not found in LXC iphost scan; likely VM or external) ip=10.1.10.70
- pve.migrahosting.com

### https://100.64.119.23/snappymail
- Owner: (not found in LXC iphost scan; likely VM or external) ip=100.64.119.23
- mail.migrahosting.com
