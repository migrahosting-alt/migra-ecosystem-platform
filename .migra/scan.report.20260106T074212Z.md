# Migra Infra Scan (20260106T074212Z)

## pve — Proxmox version & node
```
pve.migrahosting.com
pve-manager/9.1.1/42db4a6cf33dac83 (running kernel: 6.17.2-2-pve)
Linux pve.migrahosting.com 6.17.2-2-pve #1 SMP PREEMPT_DYNAMIC PMX 6.17.2-2 (2025-11-26T12:33Z) x86_64 GNU/Linux
```

## pve — VMs
```
      VMID NAME                 STATUS     MEM(MB)    BOOTDISK(GB) PID       
       100 SRV1-WEB             running    8192             100.00 239508    
       101 MAIL-CORE            running    4096              32.00 239674    
       102 dns-core             running    4096              32.00 2293904   
       103 CLOUD-CORE           running    4096              52.00 252062    
       104 VOIP-CORE            running    4096             100.00 252206    
       105 MIGRAGUARD-QUANTUM   stopped    4096              32.00 0         
       106 db-core              running    4096              32.00 239388    
       200 BASE-UBUNTU-24       stopped    4096              32.00 0         
       220 MPANEL-CORE          running    8192             200.00 239447    
       250 ubuntu-24-base-working stopped    4096              32.00 0         
```

## pve — LXCs
```
VMID       Status     Lock         Name                
136        running                 pod-elizefoundation 
137        running                 pod-premtint        
138        running                 pod-holisticgroupllc
139        running                 pod-lituationdjs    
9000       stopped                 cloudpod-template   
9099       running                 cloudpod-template-backup
```

## pve — Storage
```
Name                  Type     Status     Total (KiB)      Used (KiB) Available (KiB)        %
clients-backup     zfspool     active      1885863936      1867423240        18440696   99.02%
clients-main       zfspool     active       942932007       869575704        73356302   92.22%
iso-store              dir     active       491135216         7370056       458743396    1.50%
local                  dir     active        40453376        14930472        23435788   36.91%
t7-backup              dir     active      1921725720      1921512848               0   99.99%
vzdump-backups         dir     active       789255296       770814720        18440576   97.66%
```

## pve — Networks
```
lo               UNKNOWN        127.0.0.1/8 ::1/128 
enp10s0          UP             
vmbr0            UP             10.1.10.70/24 fe80::befc:e7ff:fe52:96e3/64 
tailscale0       UNKNOWN        100.73.199.109/32 fd7a:115c:a1e0::4d34:c76d/128 fe80::866f:da1b:7e30:982c/64 
veth137i0@if2    UP             
veth9099i0@if2   UP             
tap106i0         UNKNOWN        
tap220i0         UNKNOWN        
tap100i0         UNKNOWN        
tap101i0         UNKNOWN        
tap103i0         UNKNOWN        
tap104i0         UNKNOWN        
veth136i0@if2    UP             
veth138i0@if2    UP             
veth139i0@if2    UP             
tap102i0         UNKNOWN        
auto lo
iface lo inet loopback

iface enp10s0 inet manual

auto vmbr0
iface vmbr0 inet static
	address 10.1.10.70/24
	gateway 10.1.10.1
	bridge-ports enp10s0
	bridge-stp off
	bridge-fd 0


source /etc/network/interfaces.d/*
```

## srv1-web — NGINX status
```
# Tailscale SSH requires an additional check.
# To authenticate, visit: https://login.tailscale.com/a/lff91aeb341f95
# Authentication checked with Tailscale SSH.
# Time since last authentication: 0s
nginx version: nginx/1.24.0 (Ubuntu)
● nginx.service - A high performance web server and a reverse proxy server
     Loaded: loaded (/usr/lib/systemd/system/nginx.service; enabled; preset: enabled)
     Active: active (running) since Mon 2025-12-22 23:35:39 UTC; 2 weeks 0 days ago
       Docs: man:nginx(8)
   Main PID: 1231 (nginx)
      Tasks: 5 (limit: 9408)
     Memory: 49.5M (peak: 65.2M)
        CPU: 3min 28.068s
     CGroup: /system.slice/nginx.service
             ├─  1231 "nginx: master process /usr/sbin/nginx -g daemon on; master_process on;"
             ├─190117 "nginx: worker process"
             ├─190118 "nginx: worker process"
             ├─190119 "nginx: worker process"
             └─190120 "nginx: worker process"

Jan 04 07:09:35 srv1.migrahosting.com systemd[1]: Reloading nginx.service - A high performance web server and a reverse proxy server...
Jan 04 07:09:35 srv1.migrahosting.com nginx[190115]: 2026/01/04 07:09:35 [warn] 190115#190115: protocol options redefined for [::]:443 in /etc/nginx/sites-enabled/lituationdjs.migrahosting.com.conf:27
Jan 04 07:09:35 srv1.migrahosting.com nginx[190115]: 2026/01/04 07:09:35 [warn] 190115#190115: protocol options redefined for 0.0.0.0:443 in /etc/nginx/sites-enabled/lituationdjs.migrahosting.com.conf:28
Jan 04 07:09:35 srv1.migrahosting.com nginx[190115]: 2026/01/04 07:09:35 [warn] 190115#190115: protocol options redefined for 0.0.0.0:443 in /etc/nginx/sites-enabled/mail.migrahosting.com.conf:10
Jan 04 07:09:35 srv1.migrahosting.com nginx[190115]: 2026/01/04 07:09:35 [warn] 190115#190115: protocol options redefined for [::]:443 in /etc/nginx/sites-enabled/mail.migrahosting.com.conf:11
Jan 04 07:09:35 srv1.migrahosting.com nginx[190115]: 2026/01/04 07:09:35 [warn] 190115#190115: "ssl_stapling" ignored, no OCSP responder URL in the certificate "/etc/letsencrypt/live/call.migrahosting.com/fullchain.pem"
Jan 04 07:09:35 srv1.migrahosting.com nginx[190115]: 2026/01/04 07:09:35 [warn] 190115#190115: "ssl_stapling" ignored, no OCSP responder URL in the certificate "/etc/letsencrypt/live/migravoice.com-0001/fullchain.pem"
Jan 04 07:09:35 srv1.migrahosting.com nginx[190115]: 2026/01/04 07:09:35 [warn] 190115#190115: "ssl_stapling" ignored, no OCSP responder URL in the certificate "/etc/letsencrypt/live/voice.migrahosting.com/fullchain.pem"
Jan 04 07:09:35 srv1.migrahosting.com nginx[190115]: 2026/01/04 07:09:35 [notice] 190115#190115: signal process started
Jan 04 07:09:35 srv1.migrahosting.com systemd[1]: Reloaded nginx.service - A high performance web server and a reverse proxy server.
```

## srv1-web — NGINX config test
```
2026/01/06 07:42:26 [warn] 207230#207230: protocol options redefined for [::]:443 in /etc/nginx/sites-enabled/lituationdjs.migrahosting.com.conf:27
2026/01/06 07:42:26 [warn] 207230#207230: protocol options redefined for 0.0.0.0:443 in /etc/nginx/sites-enabled/lituationdjs.migrahosting.com.conf:28
2026/01/06 07:42:26 [warn] 207230#207230: protocol options redefined for 0.0.0.0:443 in /etc/nginx/sites-enabled/mail.migrahosting.com.conf:10
2026/01/06 07:42:26 [warn] 207230#207230: protocol options redefined for [::]:443 in /etc/nginx/sites-enabled/mail.migrahosting.com.conf:11
2026/01/06 07:42:26 [warn] 207230#207230: "ssl_stapling" ignored, no OCSP responder URL in the certificate "/etc/letsencrypt/live/call.migrahosting.com/fullchain.pem"
2026/01/06 07:42:26 [warn] 207230#207230: "ssl_stapling" ignored, no OCSP responder URL in the certificate "/etc/letsencrypt/live/migravoice.com-0001/fullchain.pem"
2026/01/06 07:42:26 [warn] 207230#207230: "ssl_stapling" ignored, no OCSP responder URL in the certificate "/etc/letsencrypt/live/voice.migrahosting.com/fullchain.pem"
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

## srv1-web — NGINX include tree (common paths)
```
==> /etc/nginx
/etc/nginx/fastcgi_params
/etc/nginx/uwsgi_params
/etc/nginx/scgi_params
/etc/nginx/proxy_params
/etc/nginx/koi-utf
/etc/nginx/sites-available/migradrive.com.conf.bak.fix.1766738097
/etc/nginx/sites-available/migrahosting.com.conf.bak.2025-12-04-0437
/etc/nginx/sites-available/intake.migrahosting.com
/etc/nginx/sites-available/elizefoundation.org.conf.bak.1764829663
/etc/nginx/sites-available/elizefoundation.org.conf.bak.1764828735
/etc/nginx/sites-available/migrapanel.com.conf
/etc/nginx/sites-available/backups-services-20251204-033442/migrapanel.com.conf
/etc/nginx/sites-available/backups-services-20251204-033442/intake.migrahosting.com.conf
/etc/nginx/sites-available/backups-services-20251204-033442/console.mb.migrahosting.com.conf
/etc/nginx/sites-available/backups-services-20251204-033442/demo.migra.local.conf
/etc/nginx/sites-available/backups-services-20251204-033442/migradrive.com.conf
/etc/nginx/sites-available/backups-services-20251204-033442/mb.migrahosting.com.conf
/etc/nginx/sites-available/backups-services-20251204-033442/mail.migrahosting.com.conf
/etc/nginx/sites-available/backups-services-20251204-033442/customerdomain.com.conf
/etc/nginx/sites-available/backups-services-20251204-033442/console.migradrive.com.conf
/etc/nginx/sites-available/backups-services-20251204-033442/elizefoundation.org.conf
/etc/nginx/sites-available/backups-services-20251204-033442/holisticgroupllc.com.conf
/etc/nginx/sites-available/backups-services-20251204-033442/s3.migradrive.com.conf
/etc/nginx/sites-available/backups-services-20251204-033442/demo-tenant.com.conf
/etc/nginx/sites-available/backups-services-20251204-033442/new.holisticgroupllc.com.conf
/etc/nginx/sites-available/backups-services-20251204-033442/migrahosting.com.conf
/etc/nginx/sites-available/voice.migrahosting.com.conf
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.20251226_092656
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656036
/etc/nginx/sites-available/console.migradrive.com.conf.bak.20251204_020456
/etc/nginx/sites-available/console.migradrive.com.conf.bak.20251204_015952
/etc/nginx/sites-available/elizefoundation.org.conf.bak.2025-12-04-0437
/etc/nginx/sites-available/console.migradrive.com.conf.before_cleanup
/etc/nginx/sites-available/intake.migrahosting.com.conf
/etc/nginx/sites-available/call.migrahosting.com
/etc/nginx/sites-available/console.mb.migrahosting.com.conf
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656067
/etc/nginx/sites-available/holisticgroupllc.com.conf.bak.2025-12-04-0437
/etc/nginx/sites-available/lituationdjs.com.conf
/etc/nginx/sites-available/console.mb.migrahosting.com.conf.bak.20251204_015952
/etc/nginx/sites-available/00-migrahosting.com.conf.bak.1764828735
/etc/nginx/sites-available/migradrive.com.conf.bak.20251204_020456
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrapanel.com.conf
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/intake.migrahosting.com.conf
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/console.mb.migrahosting.com.conf
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/demo.migra.local.conf
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migradrive.com.conf
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/mb.migrahosting.com.conf
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/mail.migrahosting.com.conf
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/customerdomain.com.conf
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/console.migradrive.com.conf
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/elizefoundation.org.conf
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/holisticgroupllc.com.conf
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/s3.migradrive.com.conf
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/demo-tenant.com.conf
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/new.holisticgroupllc.com.conf
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrahosting.com.conf
/etc/nginx/sites-available/zz-migrahosting.com.conf
/etc/nginx/sites-available/migrahosting.com.conf.bak.20251204_020456
/etc/nginx/sites-available/mail.migrahosting.com.conf.bak.20251204_015952
/etc/nginx/sites-available/demo.migra.local.conf
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_020456
/etc/nginx/sites-available/panel.migrahosting.com.conf
/etc/nginx/sites-available/migradrive.com.conf
/etc/nginx/sites-available/lituationdjs.migrahosting.com.conf
/etc/nginx/sites-available/mb.migrahosting.com.conf
/etc/nginx/sites-available/migradrive.com.conf.bak.20251204_015952
/etc/nginx/sites-available/s3.migradrive.com.conf.bak.20251204_020456
/etc/nginx/sites-available/lituationdjs.com.conf.bak-2026-01-04-020348
/etc/nginx/sites-available/migramail.com.conf
/etc/nginx/sites-available/holisticgroupllc.com
/etc/nginx/sites-available/mail.migrahosting.com.conf
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_015952
/etc/nginx/sites-available/holisticgroupllc.com.conf.save
/etc/nginx/sites-available/customerdomain.com.conf
/etc/nginx/sites-available/migrapanel.com.conf.bak.20251204_015952
/etc/nginx/sites-available/mail.migrahosting.com.conf.ssl_backup
/etc/nginx/sites-available/console.mb.migrahosting.com.conf.ssl_backup
/etc/nginx/sites-available/console.migradrive.com.conf
/etc/nginx/sites-available/call.migrahosting.com.conf
/etc/nginx/sites-available/migrapanel.com.save
/etc/nginx/sites-available/migrahosting.com.conf.bak.2025-12-04-0553
/etc/nginx/sites-available/elizefoundation.org.conf
/etc/nginx/sites-available/migravoice.com.conf
/etc/nginx/sites-available/lituation.migrahosting.com.conf.bak.20251223-072658
/etc/nginx/sites-available/holisticgroupllc.com.conf
/etc/nginx/sites-available/migrahosting.com.conf.bak.2025-12-04-0554
/etc/nginx/sites-available/s3.migradrive.com.conf
/etc/nginx/sites-available/premtint.com.conf
/etc/nginx/sites-available/default
/etc/nginx/sites-available/s3.migradrive.com.conf.before_cleanup
/etc/nginx/sites-available/mpanel.migrahosting.com.conf
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.
/etc/nginx/sites-available/demo-tenant.com.conf
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766827968
/etc/nginx/sites-available/new.holisticgroupllc.com.conf
/etc/nginx/sites-available/migradrive.com.conf.bak.1766720113
/etc/nginx/sites-available/lituationdjs.com.conf.bak.1767044599538
/etc/nginx/sites-available/migradrive.com.conf.before_cleanup
/etc/nginx/sites-available/backup-20251119-110613/migrapanel.com.conf
/etc/nginx/sites-available/backup-20251119-110613/mail.migrahosting.com.conf
/etc/nginx/sites-available/backup-20251119-110613/customerdomain.com.conf
/etc/nginx/sites-available/backup-20251119-110613/elizefoundation.org.conf
/etc/nginx/sites-available/backup-20251119-110613/holisticgroupllc.com.conf
/etc/nginx/sites-available/backup-20251119-110613/migrahosting.com.conf
/etc/nginx/sites-available/s3.migradrive.com.conf.bak.20251204_015952
/etc/nginx/sites-available/migrahosting
/etc/nginx/sites-available/migrapanel.com.conf.bak.20251204_020456
/etc/nginx/sites-available/intake.migrahosting.com.conf.ssl_backup
/etc/nginx/sites-available/pve.migrahosting.com.conf
/etc/nginx/sites-available/migradrive-migrahosting-http-proxy.conf
/etc/nginx/sites-available/lituation.migrahosting.com.conf
/etc/nginx/fastcgi.conf
/etc/nginx/mime.types
/etc/nginx/win-utf
/etc/nginx/koi-win
/etc/nginx/sites-enabled/zz-migrahosting.com.conf
/etc/nginx/sites-enabled/elizefoundation.org.conf
/etc/nginx/sites-enabled/premtint.com.conf
/etc/nginx/sites-enabled/mpanel.migrahosting.com.conf
/etc/nginx/snippets/fastcgi-php.conf
/etc/nginx/snippets/security-headers.conf
/etc/nginx/snippets/snakeoil.conf
/etc/nginx/snippets/php-fpm.conf
/etc/nginx/snippets/no-cache-html.conf
/etc/nginx/nginx.conf
```

## srv1-web — Enabled sites (Debian-style if present)
```
total 32
drwxr-xr-x 2 root root 4096 Jan  4 07:08 .
drwxr-xr-x 8 root root 4096 Dec 29 21:43 ..
lrwxrwxrwx 1 root root   53 Dec 10 19:29 call.migrahosting.com.conf -> /etc/nginx/sites-available/call.migrahosting.com.conf
lrwxrwxrwx 1 root root   51 Dec  4 07:30 console.mb.migrahosting.com.conf -> ../sites-available/console.mb.migrahosting.com.conf
lrwxrwxrwx 1 root root   46 Dec  4 07:30 console.migradrive.com.conf -> ../sites-available/console.migradrive.com.conf
-rw-r--r-- 1 root root 1078 Dec  4 07:04 elizefoundation.org.conf
lrwxrwxrwx 1 root root   44 Dec  4 07:30 holisticgroupllc.com.conf -> ../sites-available/holisticgroupllc.com.conf
lrwxrwxrwx 1 root root   50 Dec  7 04:28 intake.migrahosting.com -> /etc/nginx/sites-available/intake.migrahosting.com
lrwxrwxrwx 1 root root   58 Dec 13 02:46 lituation.migrahosting.com.conf -> /etc/nginx/sites-available/lituation.migrahosting.com.conf
lrwxrwxrwx 1 root root   48 Jan  4 07:07 lituationdjs.com.conf -> /etc/nginx/sites-available/lituationdjs.com.conf
lrwxrwxrwx 1 root root   61 Dec 23 01:16 lituationdjs.migrahosting.com.conf -> /etc/nginx/sites-available/lituationdjs.migrahosting.com.conf
lrwxrwxrwx 1 root root   45 Dec  4 07:30 mail.migrahosting.com.conf -> ../sites-available/mail.migrahosting.com.conf
lrwxrwxrwx 1 root root   43 Dec  4 07:30 mb.migrahosting.com.conf -> ../sites-available/mb.migrahosting.com.conf
lrwxrwxrwx 1 root root   66 Dec 25 09:19 migradrive-migrahosting-http-proxy.conf -> /etc/nginx/sites-available/migradrive-migrahosting-http-proxy.conf
lrwxrwxrwx 1 root root   38 Dec  4 07:30 migradrive.com.conf -> ../sites-available/migradrive.com.conf
lrwxrwxrwx 1 root root   45 Dec  5 09:18 migramail.com.conf -> /etc/nginx/sites-available/migramail.com.conf
lrwxrwxrwx 1 root root   46 Dec 14 00:09 migrapanel.com.conf -> /etc/nginx/sites-available/migrapanel.com.conf
lrwxrwxrwx 1 root root   46 Dec 10 19:29 migravoice.com.conf -> /etc/nginx/sites-available/migravoice.com.conf
-rw-r--r-- 1 root root 1281 Dec 26 09:43 mpanel.migrahosting.com.conf
lrwxrwxrwx 1 root root   54 Dec 14 12:27 panel.migrahosting.com.conf -> /etc/nginx/sites-available/panel.migrahosting.com.conf
-rw-r--r-- 1 root root 2360 Jan  4 06:05 premtint.com.conf
lrwxrwxrwx 1 root root   44 Dec  4 07:30 pve.migrahosting.com.conf -> ../sites-available/pve.migrahosting.com.conf
lrwxrwxrwx 1 root root   41 Dec  4 07:30 s3.migradrive.com.conf -> ../sites-available/s3.migradrive.com.conf
lrwxrwxrwx 1 root root   54 Dec 10 19:29 voice.migrahosting.com.conf -> /etc/nginx/sites-available/voice.migrahosting.com.conf
-rw-r--r-- 1 root root 1113 Dec 15 11:52 zz-migrahosting.com.conf
total 8
drwxr-xr-x 2 root root 4096 Aug 22 12:45 .
drwxr-xr-x 8 root root 4096 Dec 29 21:43 ..
```

## srv1-web — Domain → upstream hints (best-effort grep)
```
/etc/nginx/fastcgi_params:23:fastcgi_param  SERVER_NAME        $server_name;
/etc/nginx/uwsgi_params:17:uwsgi_param  SERVER_NAME        $server_name;
/etc/nginx/scgi_params:17:scgi_param  SERVER_NAME        $server_name;
/etc/nginx/sites-available/migradrive.com.conf.bak.fix.1766738097:3:    listen 80;
/etc/nginx/sites-available/migradrive.com.conf.bak.fix.1766738097:4:    server_name migradrive.com;
/etc/nginx/sites-available/migradrive.com.conf.bak.fix.1766738097:10:    listen 80;
/etc/nginx/sites-available/migradrive.com.conf.bak.fix.1766738097:11:    listen [::]:80;
/etc/nginx/sites-available/migradrive.com.conf.bak.fix.1766738097:12:    server_name migradrive.com www.migradrive.com;
/etc/nginx/sites-available/migradrive.com.conf.bak.fix.1766738097:39:    listen 443 ssl http2;
/etc/nginx/sites-available/migrahosting.com.conf.bak.2025-12-04-0437:3:    listen 80;
/etc/nginx/sites-available/migrahosting.com.conf.bak.2025-12-04-0437:4:    listen [::]:80;
/etc/nginx/sites-available/migrahosting.com.conf.bak.2025-12-04-0437:5:    server_name migrahosting.com www.migrahosting.com;
/etc/nginx/sites-available/migrahosting.com.conf.bak.2025-12-04-0437:11:    listen 443 ssl http2;
/etc/nginx/sites-available/migrahosting.com.conf.bak.2025-12-04-0437:12:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/migrahosting.com.conf.bak.2025-12-04-0437:13:    server_name migrahosting.com www.migrahosting.com;
/etc/nginx/sites-available/migrahosting.com.conf.bak.2025-12-04-0437:28:        proxy_pass http://127.0.0.1:4242;
/etc/nginx/sites-available/intake.migrahosting.com:2:    listen 80;
/etc/nginx/sites-available/intake.migrahosting.com:3:    listen [::]:80;
/etc/nginx/sites-available/intake.migrahosting.com:4:    server_name intake.migrahosting.com;
/etc/nginx/sites-available/intake.migrahosting.com:5:    return 301 https://$server_name$request_uri;
/etc/nginx/sites-available/intake.migrahosting.com:9:    listen 443 ssl http2;
/etc/nginx/sites-available/intake.migrahosting.com:10:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/intake.migrahosting.com:11:    server_name intake.migrahosting.com;
/etc/nginx/sites-available/intake.migrahosting.com:23:        proxy_pass http://127.0.0.1:4000;
/etc/nginx/sites-available/intake.migrahosting.com:33:        proxy_pass http://127.0.0.1:4000;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.1764829663:3:    listen 80;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.1764829663:4:    listen [::]:80;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.1764829663:5:    server_name elizefoundation.org www.elizefoundation.org;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.1764829663:11:    listen 443 ssl http2;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.1764829663:12:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.1764829663:13:    server_name elizefoundation.org www.elizefoundation.org;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.1764828735:3:    listen 80;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.1764828735:4:    listen [::]:80;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.1764828735:5:    server_name elizefoundation.org www.elizefoundation.org;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.1764828735:11:    listen 443 ssl http2;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.1764828735:12:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.1764828735:13:    server_name elizefoundation.org www.elizefoundation.org;
/etc/nginx/sites-available/migrapanel.com.conf:2:  listen 80;
/etc/nginx/sites-available/migrapanel.com.conf:3:  server_name migrapanel.com www.migrapanel.com;
/etc/nginx/sites-available/migrapanel.com.conf:8:  listen 443 ssl http2;
/etc/nginx/sites-available/migrapanel.com.conf:9:  server_name migrapanel.com www.migrapanel.com;
/etc/nginx/sites-available/backups-services-20251204-033442/migrapanel.com.conf:2:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/migrapanel.com.conf:3:    server_name migrapanel.com www.migrapanel.com;
/etc/nginx/sites-available/backups-services-20251204-033442/migrapanel.com.conf:15:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-services-20251204-033442/migrapanel.com.conf:16:    server_name migrapanel.com www.migrapanel.com;
/etc/nginx/sites-available/backups-services-20251204-033442/migrapanel.com.conf:33:        proxy_pass http://10.1.10.206:2273/;
/etc/nginx/sites-available/backups-services-20251204-033442/migrapanel.com.conf:39:        proxy_pass http://10.1.10.206:2271;
/etc/nginx/sites-available/backups-services-20251204-033442/migrapanel.com.conf:46:        proxy_pass http://10.1.10.206:2271;
/etc/nginx/sites-available/backups-services-20251204-033442/migrapanel.com.conf:51:        proxy_pass http://10.1.10.206:2271;
/etc/nginx/sites-available/backups-services-20251204-033442/migrapanel.com.conf:59:        proxy_pass http://10.1.10.206:80;
/etc/nginx/sites-available/backups-services-20251204-033442/intake.migrahosting.com.conf:7:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/intake.migrahosting.com.conf:8:    server_name intake.migrahosting.com;
/etc/nginx/sites-available/backups-services-20251204-033442/intake.migrahosting.com.conf:15:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-services-20251204-033442/intake.migrahosting.com.conf:16:    server_name intake.migrahosting.com;
/etc/nginx/sites-available/backups-services-20251204-033442/intake.migrahosting.com.conf:23:        proxy_pass http://100.107.92.101:2271;
/etc/nginx/sites-available/backups-services-20251204-033442/console.mb.migrahosting.com.conf:2:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/console.mb.migrahosting.com.conf:3:    server_name console.mb.migrahosting.com;
/etc/nginx/sites-available/backups-services-20251204-033442/console.mb.migrahosting.com.conf:8:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-services-20251204-033442/console.mb.migrahosting.com.conf:9:    server_name console.mb.migrahosting.com;
/etc/nginx/sites-available/backups-services-20251204-033442/console.mb.migrahosting.com.conf:18:        proxy_pass http://100.107.92.101:9001;
/etc/nginx/sites-available/backups-services-20251204-033442/demo.migra.local.conf:2:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/demo.migra.local.conf:3:    listen [::]:80;
/etc/nginx/sites-available/backups-services-20251204-033442/demo.migra.local.conf:4:    server_name demo.migra.local www.demo.migra.local;
/etc/nginx/sites-available/backups-services-20251204-033442/migradrive.com.conf:3:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/migradrive.com.conf:4:    server_name migradrive.com;
/etc/nginx/sites-available/backups-services-20251204-033442/migradrive.com.conf:10:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/migradrive.com.conf:11:    listen [::]:80;
/etc/nginx/sites-available/backups-services-20251204-033442/migradrive.com.conf:12:    server_name migradrive.com www.migradrive.com;
/etc/nginx/sites-available/backups-services-20251204-033442/migradrive.com.conf:27:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-services-20251204-033442/mb.migrahosting.com.conf:2:    server_name mb.migrahosting.com;
/etc/nginx/sites-available/backups-services-20251204-033442/mb.migrahosting.com.conf:6:        proxy_pass http://100.107.92.101:9000;
/etc/nginx/sites-available/backups-services-20251204-033442/mb.migrahosting.com.conf:14:    listen 443 ssl; # managed by Certbot
/etc/nginx/sites-available/backups-services-20251204-033442/mb.migrahosting.com.conf:28:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/mb.migrahosting.com.conf:29:    server_name mb.migrahosting.com;
/etc/nginx/sites-available/backups-services-20251204-033442/mail.migrahosting.com.conf:2:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/mail.migrahosting.com.conf:3:    server_name mail.migrahosting.com;
/etc/nginx/sites-available/backups-services-20251204-033442/mail.migrahosting.com.conf:8:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-services-20251204-033442/mail.migrahosting.com.conf:9:    server_name mail.migrahosting.com;
/etc/nginx/sites-available/backups-services-20251204-033442/mail.migrahosting.com.conf:18:        proxy_pass http://100.107.92.101:8080;
/etc/nginx/sites-available/backups-services-20251204-033442/customerdomain.com.conf:2:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/customerdomain.com.conf:3:    listen [::]:80;
/etc/nginx/sites-available/backups-services-20251204-033442/customerdomain.com.conf:4:    server_name customerdomain.com www.customerdomain.com;
/etc/nginx/sites-available/backups-services-20251204-033442/console.migradrive.com.conf:3:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/console.migradrive.com.conf:4:    server_name console.migradrive.com;
/etc/nginx/sites-available/backups-services-20251204-033442/console.migradrive.com.conf:10:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/console.migradrive.com.conf:11:    server_name console.migradrive.com;
/etc/nginx/sites-available/backups-services-20251204-033442/console.migradrive.com.conf:14:        proxy_pass http://100.107.92.101:9001;
/etc/nginx/sites-available/backups-services-20251204-033442/console.migradrive.com.conf:23:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-services-20251204-033442/elizefoundation.org.conf:3:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/elizefoundation.org.conf:4:    listen [::]:80;
/etc/nginx/sites-available/backups-services-20251204-033442/elizefoundation.org.conf:5:    server_name elizefoundation.org www.elizefoundation.org;
/etc/nginx/sites-available/backups-services-20251204-033442/elizefoundation.org.conf:11:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-services-20251204-033442/elizefoundation.org.conf:12:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/backups-services-20251204-033442/elizefoundation.org.conf:13:    server_name elizefoundation.org www.elizefoundation.org;
/etc/nginx/sites-available/backups-services-20251204-033442/holisticgroupllc.com.conf:3:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/holisticgroupllc.com.conf:4:    server_name holisticgroupllc.com www.holisticgroupllc.com;
/etc/nginx/sites-available/backups-services-20251204-033442/holisticgroupllc.com.conf:20:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-services-20251204-033442/holisticgroupllc.com.conf:21:    server_name holisticgroupllc.com www.holisticgroupllc.com;
/etc/nginx/sites-available/backups-services-20251204-033442/s3.migradrive.com.conf:3:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/s3.migradrive.com.conf:4:    server_name s3.migradrive.com;
/etc/nginx/sites-available/backups-services-20251204-033442/s3.migradrive.com.conf:10:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/s3.migradrive.com.conf:11:    server_name s3.migradrive.com;
/etc/nginx/sites-available/backups-services-20251204-033442/s3.migradrive.com.conf:14:        proxy_pass http://100.107.92.101:9000;
/etc/nginx/sites-available/backups-services-20251204-033442/s3.migradrive.com.conf:21:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-services-20251204-033442/demo-tenant.com.conf:2:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/demo-tenant.com.conf:3:    listen [::]:80;
/etc/nginx/sites-available/backups-services-20251204-033442/demo-tenant.com.conf:4:    server_name demo-tenant.com www.demo-tenant.com;
/etc/nginx/sites-available/backups-services-20251204-033442/new.holisticgroupllc.com.conf:2:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/new.holisticgroupllc.com.conf:3:    listen [::]:80;
/etc/nginx/sites-available/backups-services-20251204-033442/new.holisticgroupllc.com.conf:5:    server_name new.holisticgroupllc.com;
/etc/nginx/sites-available/backups-services-20251204-033442/migrahosting.com.conf:3:    listen 80;
/etc/nginx/sites-available/backups-services-20251204-033442/migrahosting.com.conf:4:    listen [::]:80;
/etc/nginx/sites-available/backups-services-20251204-033442/migrahosting.com.conf:5:    server_name migrahosting.com www.migrahosting.com;
/etc/nginx/sites-available/backups-services-20251204-033442/migrahosting.com.conf:11:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-services-20251204-033442/migrahosting.com.conf:12:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/backups-services-20251204-033442/migrahosting.com.conf:13:    server_name migrahosting.com www.migrahosting.com;
/etc/nginx/sites-available/backups-services-20251204-033442/migrahosting.com.conf:28:        proxy_pass http://127.0.0.1:4242;
/etc/nginx/sites-available/voice.migrahosting.com.conf:5:    listen 80;
/etc/nginx/sites-available/voice.migrahosting.com.conf:6:    listen [::]:80;
/etc/nginx/sites-available/voice.migrahosting.com.conf:7:    server_name voice.migrahosting.com;
/etc/nginx/sites-available/voice.migrahosting.com.conf:12:    listen 443 ssl http2;
/etc/nginx/sites-available/voice.migrahosting.com.conf:13:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/voice.migrahosting.com.conf:14:    server_name voice.migrahosting.com;
/etc/nginx/sites-available/voice.migrahosting.com.conf:42:        proxy_pass http://127.0.0.1:3003/;
/etc/nginx/sites-available/voice.migrahosting.com.conf:57:        proxy_pass http://127.0.0.1:3003/widgets/;
/etc/nginx/sites-available/voice.migrahosting.com.conf:84:        proxy_pass http://127.0.0.1:3003/ws/admin;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.20251226_092656:2:    listen 80;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.20251226_092656:3:    listen [::]:80;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.20251226_092656:4:    server_name mpanel.migrahosting.com;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.20251226_092656:7:        return 301 https://$server_name$request_uri;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.20251226_092656:12:    listen 443 ssl http2;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.20251226_092656:13:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.20251226_092656:14:    server_name mpanel.migrahosting.com;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.20251226_092656:26:        proxy_ssl_server_name on;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.20251226_092656:29:        proxy_pass https://10.1.10.240;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656036:2:    listen 80;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656036:3:    listen [::]:80;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656036:4:    server_name mpanel.migrahosting.com;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656036:7:        return 301 https://$server_name$request_uri;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656036:12:    listen 443 ssl http2;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656036:13:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656036:14:    server_name mpanel.migrahosting.com;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656036:26:        proxy_pass http://100.97.213.11;
/etc/nginx/sites-available/console.migradrive.com.conf.bak.20251204_020456:2:    listen 80;
/etc/nginx/sites-available/console.migradrive.com.conf.bak.20251204_020456:3:    server_name console.migradrive.com;
/etc/nginx/sites-available/console.migradrive.com.conf.bak.20251204_020456:6:        proxy_pass http://100.107.92.101:9001;
/etc/nginx/sites-available/console.migradrive.com.conf.bak.20251204_015952:2:    listen 80;
/etc/nginx/sites-available/console.migradrive.com.conf.bak.20251204_015952:3:    server_name console.migradrive.com;
/etc/nginx/sites-available/console.migradrive.com.conf.bak.20251204_015952:6:        proxy_pass http://100.107.92.101:9001;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.2025-12-04-0437:3:    listen 80;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.2025-12-04-0437:4:    listen [::]:80;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.2025-12-04-0437:5:    server_name elizefoundation.org www.elizefoundation.org;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.2025-12-04-0437:11:    listen 443 ssl http2;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.2025-12-04-0437:12:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/elizefoundation.org.conf.bak.2025-12-04-0437:13:    server_name elizefoundation.org www.elizefoundation.org;
/etc/nginx/sites-available/console.migradrive.com.conf.before_cleanup:3:    listen 80;
/etc/nginx/sites-available/console.migradrive.com.conf.before_cleanup:4:    server_name console.migradrive.com;
/etc/nginx/sites-available/console.migradrive.com.conf.before_cleanup:10:    listen 80;
/etc/nginx/sites-available/console.migradrive.com.conf.before_cleanup:11:    server_name console.migradrive.com;
/etc/nginx/sites-available/console.migradrive.com.conf.before_cleanup:14:        proxy_pass http://100.107.92.101:9001;
/etc/nginx/sites-available/console.migradrive.com.conf.before_cleanup:23:    listen 443 ssl http2;
/etc/nginx/sites-available/intake.migrahosting.com.conf:2:    listen 80;
/etc/nginx/sites-available/intake.migrahosting.com.conf:3:    listen [::]:80;
/etc/nginx/sites-available/intake.migrahosting.com.conf:4:    server_name intake.migrahosting.com;
/etc/nginx/sites-available/intake.migrahosting.com.conf:9:    listen 443 ssl http2;
/etc/nginx/sites-available/intake.migrahosting.com.conf:10:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/intake.migrahosting.com.conf:11:    server_name intake.migrahosting.com;
/etc/nginx/sites-available/intake.migrahosting.com.conf:19:        proxy_pass         http://100.97.213.11:2271;
/etc/nginx/sites-available/call.migrahosting.com:2:    listen 80;
/etc/nginx/sites-available/call.migrahosting.com:3:    listen [::]:80;
/etc/nginx/sites-available/call.migrahosting.com:4:    server_name call.migrahosting.com;
/etc/nginx/sites-available/call.migrahosting.com:9:    listen 443 ssl http2;
/etc/nginx/sites-available/call.migrahosting.com:10:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/call.migrahosting.com:11:    server_name call.migrahosting.com;
/etc/nginx/sites-available/console.mb.migrahosting.com.conf:2:    listen 80;
/etc/nginx/sites-available/console.mb.migrahosting.com.conf:3:    server_name console.mb.migrahosting.com;
/etc/nginx/sites-available/console.mb.migrahosting.com.conf:8:    listen 443 ssl http2;
/etc/nginx/sites-available/console.mb.migrahosting.com.conf:9:    server_name console.mb.migrahosting.com;
/etc/nginx/sites-available/console.mb.migrahosting.com.conf:18:        proxy_pass http://100.107.92.101:9001;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656067:2:    listen 80;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656067:3:    listen [::]:80;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656067:4:    server_name mpanel.migrahosting.com;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656067:7:        return 301 https://$server_name$request_uri;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656067:12:    listen 443 ssl http2;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656067:13:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656067:14:    server_name mpanel.migrahosting.com;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656067:26:        proxy_ssl_server_name on;
/etc/nginx/sites-available/mpanel.migrahosting.com.conf.bak.1766656067:29:        proxy_pass https://10.1.10.240;
/etc/nginx/sites-available/holisticgroupllc.com.conf.bak.2025-12-04-0437:3:    listen 80;
/etc/nginx/sites-available/holisticgroupllc.com.conf.bak.2025-12-04-0437:4:    server_name holisticgroupllc.com www.holisticgroupllc.com;
/etc/nginx/sites-available/holisticgroupllc.com.conf.bak.2025-12-04-0437:20:    listen 443 ssl http2;
/etc/nginx/sites-available/holisticgroupllc.com.conf.bak.2025-12-04-0437:21:    server_name holisticgroupllc.com www.holisticgroupllc.com;
/etc/nginx/sites-available/lituationdjs.com.conf:4:    listen 80;
/etc/nginx/sites-available/lituationdjs.com.conf:5:    listen [::]:80;
/etc/nginx/sites-available/lituationdjs.com.conf:6:    server_name lituationdjs.com www.lituationdjs.com;
/etc/nginx/sites-available/lituationdjs.com.conf:12:    listen 443 ssl http2;
/etc/nginx/sites-available/lituationdjs.com.conf:13:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/lituationdjs.com.conf:14:    server_name lituationdjs.com www.lituationdjs.com;
/etc/nginx/sites-available/lituationdjs.com.conf:31:        proxy_pass http://10.1.10.53:80;
/etc/nginx/sites-available/lituationdjs.com.conf:48:        proxy_pass http://10.1.10.53:80;
/etc/nginx/sites-available/console.mb.migrahosting.com.conf.bak.20251204_015952:2:    listen 80;
/etc/nginx/sites-available/console.mb.migrahosting.com.conf.bak.20251204_015952:3:    server_name console.mb.migrahosting.com;
/etc/nginx/sites-available/console.mb.migrahosting.com.conf.bak.20251204_015952:11:    listen 443 ssl http2;
/etc/nginx/sites-available/console.mb.migrahosting.com.conf.bak.20251204_015952:12:    server_name console.mb.migrahosting.com;
/etc/nginx/sites-available/console.mb.migrahosting.com.conf.bak.20251204_015952:20:        proxy_pass http://100.107.92.101:9001;
/etc/nginx/sites-available/00-migrahosting.com.conf.bak.1764828735:2:    listen 80;
/etc/nginx/sites-available/00-migrahosting.com.conf.bak.1764828735:3:    listen [::]:80;
/etc/nginx/sites-available/00-migrahosting.com.conf.bak.1764828735:4:    server_name migrahosting.com www.migrahosting.com;
/etc/nginx/sites-available/00-migrahosting.com.conf.bak.1764828735:9:    listen 443 ssl http2 default_server;
/etc/nginx/sites-available/00-migrahosting.com.conf.bak.1764828735:10:    listen [::]:443 ssl http2 default_server;
/etc/nginx/sites-available/00-migrahosting.com.conf.bak.1764828735:11:    server_name migrahosting.com www.migrahosting.com;
/etc/nginx/sites-available/migradrive.com.conf.bak.20251204_020456:2:    listen 80;
/etc/nginx/sites-available/migradrive.com.conf.bak.20251204_020456:3:    listen [::]:80;
/etc/nginx/sites-available/migradrive.com.conf.bak.20251204_020456:4:    server_name migradrive.com www.migradrive.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrapanel.com.conf:2:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrapanel.com.conf:3:    server_name migrapanel.com www.migrapanel.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrapanel.com.conf:15:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrapanel.com.conf:16:    server_name migrapanel.com www.migrapanel.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrapanel.com.conf:33:        proxy_pass http://10.1.10.206:2273/;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrapanel.com.conf:39:        proxy_pass http://10.1.10.206:2271;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrapanel.com.conf:46:        proxy_pass http://10.1.10.206:2271;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrapanel.com.conf:51:        proxy_pass http://10.1.10.206:2271;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrapanel.com.conf:59:        proxy_pass http://10.1.10.206:80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/intake.migrahosting.com.conf:2:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/intake.migrahosting.com.conf:3:    server_name intake.migrahosting.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/intake.migrahosting.com.conf:8:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/intake.migrahosting.com.conf:9:    server_name intake.migrahosting.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/intake.migrahosting.com.conf:17:        proxy_pass http://100.107.92.101:2271;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/console.mb.migrahosting.com.conf:2:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/console.mb.migrahosting.com.conf:3:    server_name console.mb.migrahosting.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/console.mb.migrahosting.com.conf:8:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/console.mb.migrahosting.com.conf:9:    server_name console.mb.migrahosting.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/console.mb.migrahosting.com.conf:18:        proxy_pass http://100.107.92.101:9001;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/demo.migra.local.conf:2:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/demo.migra.local.conf:3:    listen [::]:80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/demo.migra.local.conf:4:    server_name demo.migra.local www.demo.migra.local;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migradrive.com.conf:3:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migradrive.com.conf:4:    server_name migradrive.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migradrive.com.conf:10:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migradrive.com.conf:11:    listen [::]:80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migradrive.com.conf:12:    server_name migradrive.com www.migradrive.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migradrive.com.conf:27:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/mb.migrahosting.com.conf:2:    server_name mb.migrahosting.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/mb.migrahosting.com.conf:6:        proxy_pass http://100.107.92.101:9000;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/mb.migrahosting.com.conf:14:    listen 443 ssl; # managed by Certbot
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/mb.migrahosting.com.conf:28:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/mb.migrahosting.com.conf:29:    server_name mb.migrahosting.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/mail.migrahosting.com.conf:2:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/mail.migrahosting.com.conf:3:    server_name mail.migrahosting.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/mail.migrahosting.com.conf:8:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/mail.migrahosting.com.conf:9:    server_name mail.migrahosting.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/mail.migrahosting.com.conf:18:        proxy_pass http://100.107.92.101:8080;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/customerdomain.com.conf:2:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/customerdomain.com.conf:3:    listen [::]:80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/customerdomain.com.conf:4:    server_name customerdomain.com www.customerdomain.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/console.migradrive.com.conf:3:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/console.migradrive.com.conf:4:    server_name console.migradrive.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/console.migradrive.com.conf:10:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/console.migradrive.com.conf:11:    server_name console.migradrive.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/console.migradrive.com.conf:14:        proxy_pass http://100.107.92.101:9001;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/console.migradrive.com.conf:23:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/elizefoundation.org.conf:3:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/elizefoundation.org.conf:4:    listen [::]:80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/elizefoundation.org.conf:5:    server_name elizefoundation.org www.elizefoundation.org;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/elizefoundation.org.conf:11:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/elizefoundation.org.conf:12:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/elizefoundation.org.conf:13:    server_name elizefoundation.org www.elizefoundation.org;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/holisticgroupllc.com.conf:3:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/holisticgroupllc.com.conf:4:    server_name holisticgroupllc.com www.holisticgroupllc.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/holisticgroupllc.com.conf:20:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/holisticgroupllc.com.conf:21:    server_name holisticgroupllc.com www.holisticgroupllc.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/s3.migradrive.com.conf:3:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/s3.migradrive.com.conf:4:    server_name s3.migradrive.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/s3.migradrive.com.conf:10:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/s3.migradrive.com.conf:11:    server_name s3.migradrive.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/s3.migradrive.com.conf:14:        proxy_pass http://100.107.92.101:9000;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/s3.migradrive.com.conf:21:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/demo-tenant.com.conf:2:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/demo-tenant.com.conf:3:    listen [::]:80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/demo-tenant.com.conf:4:    server_name demo-tenant.com www.demo-tenant.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/new.holisticgroupllc.com.conf:2:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/new.holisticgroupllc.com.conf:3:    listen [::]:80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/new.holisticgroupllc.com.conf:5:    server_name new.holisticgroupllc.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrahosting.com.conf:3:    listen 80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrahosting.com.conf:4:    listen [::]:80;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrahosting.com.conf:5:    server_name migrahosting.com www.migrahosting.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrahosting.com.conf:11:    listen 443 ssl http2;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrahosting.com.conf:12:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrahosting.com.conf:13:    server_name migrahosting.com www.migrahosting.com;
/etc/nginx/sites-available/backups-ssl-2025-12-04-025122/migrahosting.com.conf:28:        proxy_pass http://127.0.0.1:4242;
/etc/nginx/sites-available/zz-migrahosting.com.conf:2:    listen 80 default_server;
/etc/nginx/sites-available/zz-migrahosting.com.conf:3:    listen [::]:80 default_server;
/etc/nginx/sites-available/zz-migrahosting.com.conf:4:    server_name migrahosting.com www.migrahosting.com;
/etc/nginx/sites-available/zz-migrahosting.com.conf:9:    listen 443 ssl http2 default_server;
/etc/nginx/sites-available/zz-migrahosting.com.conf:10:    listen [::]:443 ssl http2 default_server;
/etc/nginx/sites-available/zz-migrahosting.com.conf:11:    server_name migrahosting.com www.migrahosting.com;
/etc/nginx/sites-available/migrahosting.com.conf.bak.20251204_020456:2:    server_name migrahosting.com www.migrahosting.com;
/etc/nginx/sites-available/migrahosting.com.conf.bak.20251204_020456:10:        proxy_pass http://127.0.0.1:4242;
/etc/nginx/sites-available/migrahosting.com.conf.bak.20251204_020456:26:    listen 443 ssl;
/etc/nginx/sites-available/migrahosting.com.conf.bak.20251204_020456:34:    listen 80;
/etc/nginx/sites-available/migrahosting.com.conf.bak.20251204_020456:35:    server_name migrahosting.com www.migrahosting.com;
/etc/nginx/sites-available/mail.migrahosting.com.conf.bak.20251204_015952:2:    listen 80;
/etc/nginx/sites-available/mail.migrahosting.com.conf.bak.20251204_015952:3:    server_name mail.migrahosting.com www.mail.migrahosting.com;
/etc/nginx/sites-available/demo.migra.local.conf:2:    listen 80;
/etc/nginx/sites-available/demo.migra.local.conf:3:    listen [::]:80;
/etc/nginx/sites-available/demo.migra.local.conf:4:    server_name demo.migra.local www.demo.migra.local;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_020456:5:    listen 80;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_020456:6:    listen [::]:80;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_020456:7:    server_name intake.migrahosting.com;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_020456:10:    # return 301 https://$server_name$request_uri;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_020456:14:        proxy_pass http://127.0.0.1:4000;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_020456:46:#    listen 443 ssl http2;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_020456:47:#    listen [::]:443 ssl http2;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_020456:48:#    server_name intake.migrahosting.com;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_020456:58:#        proxy_pass http://127.0.0.1:4000;
/etc/nginx/sites-available/panel.migrahosting.com.conf:2:    listen 80;
/etc/nginx/sites-available/panel.migrahosting.com.conf:3:    listen [::]:80;
/etc/nginx/sites-available/panel.migrahosting.com.conf:4:    server_name panel.migrahosting.com;
/etc/nginx/sites-available/panel.migrahosting.com.conf:7:        return 301 https://$server_name$request_uri;
/etc/nginx/sites-available/panel.migrahosting.com.conf:12:    listen 443 ssl http2;
/etc/nginx/sites-available/panel.migrahosting.com.conf:13:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/panel.migrahosting.com.conf:14:    server_name panel.migrahosting.com;
/etc/nginx/sites-available/panel.migrahosting.com.conf:26:        proxy_pass http://10.1.10.206:2271;
/etc/nginx/sites-available/migradrive.com.conf:3:    listen 80;
/etc/nginx/sites-available/migradrive.com.conf:4:    server_name migradrive.com www.migradrive.com;
/etc/nginx/sites-available/migradrive.com.conf:10:    server_name migradrive.com www.migradrive.com;
/etc/nginx/sites-available/migradrive.com.conf:36:    listen 443 ssl http2;
/etc/nginx/sites-available/lituationdjs.migrahosting.com.conf:3:    server_name lituationdjs.migrahosting.com;
/etc/nginx/sites-available/lituationdjs.migrahosting.com.conf:27:    listen [::]:443 ssl; # managed by Certbot
/etc/nginx/sites-available/lituationdjs.migrahosting.com.conf:28:    listen 443 ssl; # managed by Certbot
/etc/nginx/sites-available/lituationdjs.migrahosting.com.conf:45:    listen 80;
/etc/nginx/sites-available/lituationdjs.migrahosting.com.conf:46:    listen [::]:80;
/etc/nginx/sites-available/lituationdjs.migrahosting.com.conf:47:    server_name lituationdjs.migrahosting.com;
/etc/nginx/sites-available/mb.migrahosting.com.conf:2:    listen 80;
/etc/nginx/sites-available/mb.migrahosting.com.conf:3:    listen [::]:80;
/etc/nginx/sites-available/mb.migrahosting.com.conf:4:    server_name mb.migrahosting.com;
/etc/nginx/sites-available/mb.migrahosting.com.conf:9:    listen 443 ssl http2;
/etc/nginx/sites-available/mb.migrahosting.com.conf:10:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/mb.migrahosting.com.conf:11:    server_name mb.migrahosting.com;
/etc/nginx/sites-available/mb.migrahosting.com.conf:22:        proxy_pass         http://100.65.164.127:9000;
/etc/nginx/sites-available/migradrive.com.conf.bak.20251204_015952:2:    listen 80;
/etc/nginx/sites-available/migradrive.com.conf.bak.20251204_015952:3:    listen [::]:80;
/etc/nginx/sites-available/migradrive.com.conf.bak.20251204_015952:4:    server_name migradrive.com www.migradrive.com;
/etc/nginx/sites-available/s3.migradrive.com.conf.bak.20251204_020456:2:    listen 80;
/etc/nginx/sites-available/s3.migradrive.com.conf.bak.20251204_020456:3:    server_name s3.migradrive.com;
/etc/nginx/sites-available/s3.migradrive.com.conf.bak.20251204_020456:6:        proxy_pass http://100.107.92.101:9000;
/etc/nginx/sites-available/lituationdjs.com.conf.bak-2026-01-04-020348:2:    server_name lituationdjs.com www.lituationdjs.com;
/etc/nginx/sites-available/lituationdjs.com.conf.bak-2026-01-04-020348:18:    listen [::]:443 ssl ipv6only=on; # managed by Certbot
/etc/nginx/sites-available/lituationdjs.com.conf.bak-2026-01-04-020348:19:    listen 443 ssl; # managed by Certbot
/etc/nginx/sites-available/lituationdjs.com.conf.bak-2026-01-04-020348:38:    listen 80;
/etc/nginx/sites-available/lituationdjs.com.conf.bak-2026-01-04-020348:39:    listen [::]:80;
/etc/nginx/sites-available/lituationdjs.com.conf.bak-2026-01-04-020348:40:    server_name lituationdjs.com www.lituationdjs.com;
/etc/nginx/sites-available/migramail.com.conf:3:    listen 80;
/etc/nginx/sites-available/migramail.com.conf:4:    listen [::]:80;
/etc/nginx/sites-available/migramail.com.conf:5:    server_name migramail.com www.migramail.com;
/etc/nginx/sites-available/migramail.com.conf:10:    listen 443 ssl http2;
/etc/nginx/sites-available/migramail.com.conf:11:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/migramail.com.conf:12:    server_name www.migramail.com;
/etc/nginx/sites-available/migramail.com.conf:23:    listen 443 ssl http2;
/etc/nginx/sites-available/migramail.com.conf:24:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/migramail.com.conf:25:    server_name migramail.com;
/etc/nginx/sites-available/migramail.com.conf:52:        proxy_pass http://100.64.119.23:3010;
/etc/nginx/sites-available/holisticgroupllc.com:2:    listen 80;
/etc/nginx/sites-available/holisticgroupllc.com:3:    server_name holisticgroupllc.com www.holisticgroupllc.com;
/etc/nginx/sites-available/mail.migrahosting.com.conf:3:    listen 80;
/etc/nginx/sites-available/mail.migrahosting.com.conf:4:    listen [::]:80;
/etc/nginx/sites-available/mail.migrahosting.com.conf:5:    server_name mail.migrahosting.com;
/etc/nginx/sites-available/mail.migrahosting.com.conf:10:    listen 443 ssl http2;
/etc/nginx/sites-available/mail.migrahosting.com.conf:11:    listen [::]:443 ssl http2;
/etc/nginx/sites-available/mail.migrahosting.com.conf:12:    server_name mail.migrahosting.com;
/etc/nginx/sites-available/mail.migrahosting.com.conf:39:        proxy_pass http://100.64.119.23:3010;
/etc/nginx/sites-available/mail.migrahosting.com.conf:52:        proxy_pass https://100.64.119.23/snappymail;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_015952:5:    listen 80;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_015952:6:    listen [::]:80;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_015952:7:    server_name intake.migrahosting.com;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_015952:10:    # return 301 https://$server_name$request_uri;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_015952:14:        proxy_pass http://127.0.0.1:4000;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_015952:46:#    listen 443 ssl http2;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_015952:47:#    listen [::]:443 ssl http2;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_015952:48:#    server_name intake.migrahosting.com;
/etc/nginx/sites-available/intake.migrahosting.com.conf.bak.20251204_015952:58:#        proxy_pass http://127.0.0.1:4000;
/etc/nginx/sites-available/holisticgroupllc.com.conf.save:7:    listen 80;
/etc/nginx/sites-available/holisticgroupllc.com.conf.save:8:    server_name holisticgroupllc.com www.holisticgroupllc.com;
/etc/nginx/sites-available/customerdomain.com.conf:2:    listen 80;
/etc/nginx/sites-available/customerdomain.com.conf:3:    listen [::]:80;
/etc/nginx/sites-available/customerdomain.com.conf:4:    server_name customerdomain.com www.customerdomain.com;
/etc/nginx/sites-available/migrapanel.com.conf.bak.20251204_015952:2:    listen 80;
/etc/nginx/sites-available/migrapanel.com.conf.bak.20251204_015952:3:    server_name migrapanel.com www.migrapanel.com;
/etc/nginx/sites-available/migrapanel.com.conf.bak.20251204_015952:15:    listen 443 ssl http2;
/etc/nginx/sites-available/migrapanel.com.conf.bak.20251204_015952:16:    server_name migrapanel.com www.migrapanel.com;
/etc/nginx/sites-available/migrapanel.com.conf.bak.20251204_015952:32:        proxy_pass http://10.1.10.206:2273/;
/etc/nginx/sites-available/migrapanel.com.conf.bak.20251204_015952:38:        proxy_pass http://10.1.10.206:2271;
/etc/nginx/sites-available/migrapanel.com.conf.bak.20251204_015952:45:        proxy_pass http://10.1.10.206:2271;
/etc/nginx/sites-available/migrapanel.com.conf.bak.20251204_015952:50:        proxy_pass http://10.1.10.206:2271;
/etc/nginx/sites-available/migrapanel.com.conf.bak.20251204_015952:58:        proxy_pass http://10.1.10.206:80;
/etc/nginx/sites-available/mail.migrahosting.com.conf.ssl_backup:2:    listen 80;
/etc/nginx/sites-available/mail.migrahosting.com.conf.ssl_backup:3:    server_name mail.migrahosting.com www.mail.migrahosting.com;
/etc/nginx/sites-available/console.mb.migrahosting.com.conf.ssl_backup:2:    listen 80;
/etc/nginx/sites-available/console.mb.migrahosting.com.conf.ssl_backup:3:    server_name console.mb.migrahosting.com;
/etc/nginx/sites-available/console.mb.migrahosting.com.conf.ssl_backup:11:    listen 443 ssl http2;
```

## mpanel-core — mPanel services (systemd units)
```
  UNIT                         LOAD   ACTIVE SUB     DESCRIPTION
  containerd.service           loaded active running containerd container runtime
  cron.service                 loaded active running Regular background program processing daemon
  dbus.service                 loaded active running D-Bus System Message Bus
  docker.service               loaded active running Docker Application Container Engine
  fail2ban.service             loaded active running Fail2Ban Service
  getty@tty1.service           loaded active running Getty on tty1
  k3s.service                  loaded active running Lightweight Kubernetes
  mariadb.service              loaded active running MariaDB 10.11.13 database server
  ModemManager.service         loaded active running Modem Manager
  mpanel-cloudpods.service     loaded active running MigraCloud CloudPods Provisioner Microservice
  mpanel-guardian-scan.service loaded active running MigraHosting Guardian Deep Scanner Microservice
  mpanel-telemetry.service     loaded active running MigraHosting Telemetry Microservice
  multipathd.service           loaded active running Device-Mapper Multipath Device Controller
  nginx.service                loaded active running A high performance web server and a reverse proxy server
  php8.3-fpm.service           loaded active running The PHP 8.3 FastCGI Process Manager
  pm2-mhadmin.service          loaded active running PM2 process manager
  polkit.service               loaded active running Authorization Manager
  postgresql@16-main.service   loaded active running PostgreSQL Cluster 16-main
  redis-server.service         loaded active running Advanced key-value store
  rsyslog.service              loaded active running System Logging Service
  snapd.service                loaded active running Snap Daemon
  ssh.service                  loaded active running OpenBSD Secure Shell server
  systemd-journald.service     loaded active running Journal Service
  systemd-logind.service       loaded active running User Login Management
  systemd-networkd.service     loaded active running Network Configuration
  systemd-resolved.service     loaded active running Network Name Resolution
  systemd-timesyncd.service    loaded active running Network Time Synchronization
  systemd-udevd.service        loaded active running Rule-based Manager for Device Events and Files
  tailscaled.service           loaded active running Tailscale node agent
  udisks2.service              loaded active running Disk Manager
  unattended-upgrades.service  loaded active running Unattended Upgrades Shutdown
  upower.service               loaded active running Daemon for power management
  user@0.service               loaded active running User Manager for UID 0

Legend: LOAD   → Reflects whether the unit definition was properly loaded.
        ACTIVE → The high-level unit activation state, i.e. generalization of SUB.
        SUB    → The low-level unit activation state, values depend on unit type.

33 loaded units listed.
```

## mpanel-core — Listeners
```
Netid State  Recv-Q Send-Q                       Local Address:Port  Peer Address:PortProcess                                                                                                                              
udp   UNCONN 0      0                              10.1.10.206:7946       0.0.0.0:*    users:(("speaker",pid=852359,fd=9))                                                                                                 
udp   UNCONN 0      0                               127.0.0.54:53         0.0.0.0:*    users:(("systemd-resolve",pid=754,fd=16))                                                                                           
udp   UNCONN 0      0                            127.0.0.53%lo:53         0.0.0.0:*    users:(("systemd-resolve",pid=754,fd=14))                                                                                           
udp   UNCONN 0      0                                  0.0.0.0:8472       0.0.0.0:*                                                                                                                                        
udp   UNCONN 0      0                                  0.0.0.0:41641      0.0.0.0:*    users:(("tailscaled",pid=799,fd=19))                                                                                                
udp   UNCONN 0      0      [fe80::be24:11ff:fee8:fbd0]%enp6s18:546           [::]:*    users:(("systemd-network",pid=629,fd=22))                                                                                           
udp   UNCONN 0      0                                     [::]:41641         [::]:*    users:(("tailscaled",pid=799,fd=17))                                                                                                
udp   UNCONN 0      0                                        *:9094             *:*    users:(("alertmanager",pid=1656,fd=6))                                                                                              
tcp   LISTEN 0      4096                             127.0.0.1:10256      0.0.0.0:*    users:(("k3s-server",pid=29903,fd=215))                                                                                             
tcp   LISTEN 0      4096                             127.0.0.1:10257      0.0.0.0:*    users:(("k3s-server",pid=29903,fd=162))                                                                                             
tcp   LISTEN 0      4096                             127.0.0.1:10258      0.0.0.0:*    users:(("k3s-server",pid=29903,fd=194))                                                                                             
tcp   LISTEN 0      4096                             127.0.0.1:10259      0.0.0.0:*    users:(("k3s-server",pid=29903,fd=210))                                                                                             
tcp   LISTEN 0      4096                             127.0.0.1:10248      0.0.0.0:*    users:(("k3s-server",pid=29903,fd=182))                                                                                             
tcp   LISTEN 0      4096                             127.0.0.1:10249      0.0.0.0:*    users:(("k3s-server",pid=29903,fd=216))                                                                                             
tcp   LISTEN 0      511                              127.0.0.1:6379       0.0.0.0:*    users:(("redis-server",pid=789,fd=20))                                                                                              
tcp   LISTEN 0      4096                             127.0.0.1:6444       0.0.0.0:*    users:(("k3s-server",pid=29903,fd=19))                                                                                              
tcp   LISTEN 0      4096                           10.1.10.206:7472       0.0.0.0:*    users:(("speaker",pid=852359,fd=13))                                                                                                
tcp   LISTEN 0      511                                0.0.0.0:443        0.0.0.0:*    users:(("nginx",pid=1205,fd=15),("nginx",pid=1204,fd=15),("nginx",pid=1203,fd=15),("nginx",pid=1202,fd=15),("nginx",pid=1200,fd=15))
tcp   LISTEN 0      4096                           10.1.10.206:7946       0.0.0.0:*    users:(("speaker",pid=852359,fd=8))                                                                                                 
tcp   LISTEN 0      511                                0.0.0.0:80         0.0.0.0:*    users:(("nginx",pid=1205,fd=13),("nginx",pid=1204,fd=13),("nginx",pid=1203,fd=13),("nginx",pid=1202,fd=13),("nginx",pid=1200,fd=13))
tcp   LISTEN 0      4096                               0.0.0.0:22         0.0.0.0:*    users:(("sshd",pid=1177,fd=3),("systemd",pid=1,fd=266))                                                                             
tcp   LISTEN 0      80                               127.0.0.1:3306       0.0.0.0:*    users:(("mariadbd",pid=942,fd=24))                                                                                                  
tcp   LISTEN 0      4096                         100.97.213.11:37079      0.0.0.0:*    users:(("tailscaled",pid=799,fd=27))                                                                                                
tcp   LISTEN 0      4096                            127.0.0.54:53         0.0.0.0:*    users:(("systemd-resolve",pid=754,fd=17))                                                                                           
tcp   LISTEN 0      4096                         127.0.0.53%lo:53         0.0.0.0:*    users:(("systemd-resolve",pid=754,fd=15))                                                                                           
tcp   LISTEN 0      511                                0.0.0.0:2272       0.0.0.0:*    users:(("node",pid=7764,fd=24))                                                                                                     
tcp   LISTEN 0      511                                0.0.0.0:2271       0.0.0.0:*    users:(("node",pid=1865046,fd=37))                                                                                                  
tcp   LISTEN 0      4096                             127.0.0.1:9090       0.0.0.0:*    users:(("prometheus",pid=1648,fd=6))                                                                                                
tcp   LISTEN 0      4096                             127.0.0.1:9093       0.0.0.0:*    users:(("alertmanager",pid=1656,fd=7))                                                                                              
tcp   LISTEN 0      200                              127.0.0.1:5432       0.0.0.0:*    users:(("postgres",pid=950,fd=6))                                                                                                   
tcp   LISTEN 0      4096                             127.0.0.1:10010      0.0.0.0:*    users:(("containerd",pid=29935,fd=13))                                                                                              
tcp   LISTEN 0      4096                                     *:9094             *:*    users:(("alertmanager",pid=1656,fd=3))                                                                                              
tcp   LISTEN 0      511                                   [::]:443           [::]:*    users:(("nginx",pid=1205,fd=16),("nginx",pid=1204,fd=16),("nginx",pid=1203,fd=16),("nginx",pid=1202,fd=16),("nginx",pid=1200,fd=16))
tcp   LISTEN 0      511                                   [::]:80            [::]:*    users:(("nginx",pid=1205,fd=14),("nginx",pid=1204,fd=14),("nginx",pid=1203,fd=14),("nginx",pid=1202,fd=14),("nginx",pid=1200,fd=14))
tcp   LISTEN 0      4096                                  [::]:22            [::]:*    users:(("sshd",pid=1177,fd=4),("systemd",pid=1,fd=268))                                                                             
tcp   LISTEN 0      4096           [fd7a:115c:a1e0::ab34:d50b]:64652         [::]:*    users:(("tailscaled",pid=799,fd=28))                                                                                                
tcp   LISTEN 0      4096                                     *:6443             *:*    users:(("k3s-server",pid=29903,fd=12))                                                                                              
tcp   LISTEN 0      511                                  [::1]:6379          [::]:*    users:(("redis-server",pid=789,fd=21))                                                                                              
tcp   LISTEN 0      4096                                     *:10250            *:*    users:(("k3s-server",pid=29903,fd=178))                                                                                             
```

## mpanel-core — System health
```
mpanel-core
 07:42:28 up 14 days,  8:06,  6 users,  load average: 1.11, 1.14, 1.17
Filesystem                         Size  Used Avail Use% Mounted on
tmpfs                              775M  5.0M  770M   1% /run
efivarfs                           256K   30K  222K  12% /sys/firmware/efi/efivars
/dev/mapper/ubuntu--vg-ubuntu--lv   60G   30G   29G  51% /
tmpfs                              3.3G  1.1M  3.3G   1% /dev/shm
tmpfs                              5.0M     0  5.0M   0% /run/lock
/dev/sda2                          2.0G  198M  1.6G  11% /boot
/dev/sda1                          1.1G  6.2M  1.1G   1% /boot/efi
overlay                             60G   30G   29G  51% /var/lib/docker/rootfs/overlayfs/ea0c5fc59f5cf072ca757cc835f046c3fe129bcf1a24a057e6b559eaf46ee63d
overlay                             60G   30G   29G  51% /var/lib/docker/rootfs/overlayfs/ff29a090ca761b1a04e08929dd7eff52d24cab74dfe451a1d917afc7f049d1d2
               total        used        free      shared  buff/cache   available
Mem:            7919        3821         212          26        4224        4098
Swap:           4095        4063          32
```

## mail-core — Mail listeners
```
Netid State  Recv-Q Send-Q                     Local Address:Port  Peer Address:PortProcess                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            
udp   UNCONN 0      0                             127.0.0.54:53         0.0.0.0:*    users:(("systemd-resolve",pid=466,fd=16))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         
udp   UNCONN 0      0                          127.0.0.53%lo:53         0.0.0.0:*    users:(("systemd-resolve",pid=466,fd=14))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         
udp   UNCONN 0      0                      10.1.10.101%ens18:68         0.0.0.0:*    users:(("systemd-network",pid=752,fd=24))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         
udp   UNCONN 0      0                                0.0.0.0:41641      0.0.0.0:*    users:(("tailscaled",pid=753,fd=17))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              
udp   UNCONN 0      0      [fe80::be24:11ff:fe0b:e8d6]%ens18:546           [::]:*    users:(("systemd-network",pid=752,fd=23))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         
udp   UNCONN 0      0                                   [::]:41641         [::]:*    users:(("tailscaled",pid=753,fd=16))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              
tcp   LISTEN 0      80                             127.0.0.1:3306       0.0.0.0:*    users:(("mariadbd",pid=1081,fd=39))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               
tcp   LISTEN 0      511                              0.0.0.0:443        0.0.0.0:*    users:(("nginx",pid=1280,fd=7),("nginx",pid=1279,fd=7),("nginx",pid=1278,fd=7),("nginx",pid=1277,fd=7),("nginx",pid=1275,fd=7))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   
tcp   LISTEN 0      100                              0.0.0.0:465        0.0.0.0:*    users:(("master",pid=2017277,fd=20))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              
tcp   LISTEN 0      4096                             0.0.0.0:22         0.0.0.0:*    users:(("sshd",pid=1291,fd=3),("systemd",pid=1,fd=87))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            
tcp   LISTEN 0      100                              0.0.0.0:25         0.0.0.0:*    users:(("master",pid=2017277,fd=13))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              
tcp   LISTEN 0      511                              0.0.0.0:80         0.0.0.0:*    users:(("nginx",pid=1280,fd=5),("nginx",pid=1279,fd=5),("nginx",pid=1278,fd=5),("nginx",pid=1277,fd=5),("nginx",pid=1275,fd=5))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   
tcp   LISTEN 0      4096                       100.64.119.23:48676      0.0.0.0:*    users:(("tailscaled",pid=753,fd=23))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              
tcp   LISTEN 0      100                              0.0.0.0:143        0.0.0.0:*    users:(("imap-login",pid=4186767,fd=7),("imap-login",pid=3210015,fd=7),("imap-login",pid=3210013,fd=7),("imap-login",pid=3210012,fd=7),("imap-login",pid=3210008,fd=7),("imap-login",pid=3210007,fd=7),("imap-login",pid=3210002,fd=7),("imap-login",pid=3210001,fd=7),("imap-login",pid=3210000,fd=7),("imap-login",pid=3209999,fd=7),("imap-login",pid=3209997,fd=7),("imap-login",pid=3209994,fd=7),("imap-login",pid=3209993,fd=7),("imap-login",pid=3209989,fd=7),("imap-login",pid=3209988,fd=7),("imap-login",pid=3209987,fd=7),("imap-login",pid=3209985,fd=7),("imap-login",pid=3209981,fd=7),("imap-login",pid=3209980,fd=7),("imap-login",pid=3209979,fd=7),("imap-login",pid=3209977,fd=7),("imap-login",pid=3209974,fd=7),("imap-login",pid=3209972,fd=7),("imap-login",pid=3209971,fd=7),("imap-login",pid=3209968,fd=7),("imap-login",pid=3209967,fd=7),("imap-login",pid=3209965,fd=7),("imap-login",pid=3209963,fd=7),("imap-login",pid=3209962,fd=7),("dovecot",pid=2017291,fd=38))                             
tcp   LISTEN 0      100                              0.0.0.0:993        0.0.0.0:*    users:(("imap-login",pid=4186767,fd=9),("imap-login",pid=3210015,fd=9),("imap-login",pid=3210013,fd=9),("imap-login",pid=3210012,fd=9),("imap-login",pid=3210008,fd=9),("imap-login",pid=3210007,fd=9),("imap-login",pid=3210002,fd=9),("imap-login",pid=3210001,fd=9),("imap-login",pid=3210000,fd=9),("imap-login",pid=3209999,fd=9),("imap-login",pid=3209997,fd=9),("imap-login",pid=3209994,fd=9),("imap-login",pid=3209993,fd=9),("imap-login",pid=3209989,fd=9),("imap-login",pid=3209988,fd=9),("imap-login",pid=3209987,fd=9),("imap-login",pid=3209985,fd=9),("imap-login",pid=3209981,fd=9),("imap-login",pid=3209980,fd=9),("imap-login",pid=3209979,fd=9),("imap-login",pid=3209977,fd=9),("imap-login",pid=3209974,fd=9),("imap-login",pid=3209972,fd=9),("imap-login",pid=3209971,fd=9),("imap-login",pid=3209968,fd=9),("imap-login",pid=3209967,fd=9),("imap-login",pid=3209965,fd=9),("imap-login",pid=3209963,fd=9),("imap-login",pid=3209962,fd=9),("dovecot",pid=2017291,fd=40))                             
tcp   LISTEN 0      100                              0.0.0.0:587        0.0.0.0:*    users:(("smtpd",pid=4190019,fd=6),("smtpd",pid=4188574,fd=6),("master",pid=2017277,fd=17))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        
tcp   LISTEN 0      4096                       127.0.0.53%lo:53         0.0.0.0:*    users:(("systemd-resolve",pid=466,fd=15))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         
tcp   LISTEN 0      4096                          127.0.0.54:53         0.0.0.0:*    users:(("systemd-resolve",pid=466,fd=17))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         
tcp   LISTEN 0      4096                           127.0.0.1:8891       0.0.0.0:*    users:(("opendkim",pid=1248,fd=3))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                
tcp   LISTEN 0      511                                 [::]:443           [::]:*    users:(("nginx",pid=1280,fd=8),("nginx",pid=1279,fd=8),("nginx",pid=1278,fd=8),("nginx",pid=1277,fd=8),("nginx",pid=1275,fd=8))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   
tcp   LISTEN 0      4096                                [::]:22            [::]:*    users:(("sshd",pid=1291,fd=4),("systemd",pid=1,fd=88))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            
tcp   LISTEN 0      511                                 [::]:80            [::]:*    users:(("nginx",pid=1280,fd=6),("nginx",pid=1279,fd=6),("nginx",pid=1278,fd=6),("nginx",pid=1277,fd=6),("nginx",pid=1275,fd=6))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   
tcp   LISTEN 0      100                                 [::]:143           [::]:*    users:(("imap-login",pid=4186767,fd=8),("imap-login",pid=3210015,fd=8),("imap-login",pid=3210013,fd=8),("imap-login",pid=3210012,fd=8),("imap-login",pid=3210008,fd=8),("imap-login",pid=3210007,fd=8),("imap-login",pid=3210002,fd=8),("imap-login",pid=3210001,fd=8),("imap-login",pid=3210000,fd=8),("imap-login",pid=3209999,fd=8),("imap-login",pid=3209997,fd=8),("imap-login",pid=3209994,fd=8),("imap-login",pid=3209993,fd=8),("imap-login",pid=3209989,fd=8),("imap-login",pid=3209988,fd=8),("imap-login",pid=3209987,fd=8),("imap-login",pid=3209985,fd=8),("imap-login",pid=3209981,fd=8),("imap-login",pid=3209980,fd=8),("imap-login",pid=3209979,fd=8),("imap-login",pid=3209977,fd=8),("imap-login",pid=3209974,fd=8),("imap-login",pid=3209972,fd=8),("imap-login",pid=3209971,fd=8),("imap-login",pid=3209968,fd=8),("imap-login",pid=3209967,fd=8),("imap-login",pid=3209965,fd=8),("imap-login",pid=3209963,fd=8),("imap-login",pid=3209962,fd=8),("dovecot",pid=2017291,fd=39))                             
tcp   LISTEN 0      100                                 [::]:993           [::]:*    users:(("imap-login",pid=4186767,fd=10),("imap-login",pid=3210015,fd=10),("imap-login",pid=3210013,fd=10),("imap-login",pid=3210012,fd=10),("imap-login",pid=3210008,fd=10),("imap-login",pid=3210007,fd=10),("imap-login",pid=3210002,fd=10),("imap-login",pid=3210001,fd=10),("imap-login",pid=3210000,fd=10),("imap-login",pid=3209999,fd=10),("imap-login",pid=3209997,fd=10),("imap-login",pid=3209994,fd=10),("imap-login",pid=3209993,fd=10),("imap-login",pid=3209989,fd=10),("imap-login",pid=3209988,fd=10),("imap-login",pid=3209987,fd=10),("imap-login",pid=3209985,fd=10),("imap-login",pid=3209981,fd=10),("imap-login",pid=3209980,fd=10),("imap-login",pid=3209979,fd=10),("imap-login",pid=3209977,fd=10),("imap-login",pid=3209974,fd=10),("imap-login",pid=3209972,fd=10),("imap-login",pid=3209971,fd=10),("imap-login",pid=3209968,fd=10),("imap-login",pid=3209967,fd=10),("imap-login",pid=3209965,fd=10),("imap-login",pid=3209963,fd=10),("imap-login",pid=3209962,fd=10),("dovecot",pid=2017291,fd=41))
tcp   LISTEN 0      511                                    *:3010             *:*    users:(("node /opt/migra",pid=1399,fd=19))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        
tcp   LISTEN 0      4096         [fd7a:115c:a1e0::3f34:7717]:65192         [::]:*    users:(("tailscaled",pid=753,fd=24))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              
```

## dns-core — DNS listeners
```
Netid State  Recv-Q Send-Q                     Local Address:Port  Peer Address:PortProcess                                                                                                                                                                                       
udp   UNCONN 0      0                                0.0.0.0:53         0.0.0.0:*    users:(("pdns_server",pid=990,fd=5))                                                                                                                                                         
udp   UNCONN 0      0                      10.1.10.102%ens18:68         0.0.0.0:*    users:(("systemd-network",pid=451,fd=22))                                                                                                                                                    
udp   UNCONN 0      0                                0.0.0.0:41641      0.0.0.0:*    users:(("tailscaled",pid=686,fd=18))                                                                                                                                                         
udp   UNCONN 0      0                                0.0.0.0:12984      0.0.0.0:*    users:(("pdns_server",pid=990,fd=19))                                                                                                                                                        
udp   UNCONN 0      0                                      *:10482            *:*    users:(("pdns_server",pid=990,fd=20))                                                                                                                                                        
udp   UNCONN 0      0      [fe80::be24:11ff:fec9:7682]%ens18:546           [::]:*    users:(("systemd-network",pid=451,fd=23))                                                                                                                                                    
udp   UNCONN 0      0                                   [::]:41641         [::]:*    users:(("tailscaled",pid=686,fd=17))                                                                                                                                                         
tcp   LISTEN 0      4096                             0.0.0.0:22         0.0.0.0:*    users:(("sshd",pid=1013,fd=3),("systemd",pid=1,fd=85))                                                                                                                                       
tcp   LISTEN 0      128                              0.0.0.0:53         0.0.0.0:*    users:(("pdns_server",pid=990,fd=6))                                                                                                                                                         
tcp   LISTEN 0      4096                       100.73.241.82:36729      0.0.0.0:*    users:(("tailscaled",pid=686,fd=26))                                                                                                                                                         
tcp   LISTEN 0      10                               0.0.0.0:8081       0.0.0.0:*    users:(("pdns_server",pid=990,fd=7))                                                                                                                                                         
tcp   LISTEN 0      80                             127.0.0.1:3306       0.0.0.0:*    users:(("mariadbd",pid=815,fd=31))                                                                                                                                                           
tcp   LISTEN 0      511                                    *:80               *:*    users:(("apache2",pid=1122,fd=4),("apache2",pid=1060,fd=4),("apache2",pid=1059,fd=4),("apache2",pid=1058,fd=4),("apache2",pid=1057,fd=4),("apache2",pid=1056,fd=4),("apache2",pid=1016,fd=4))
tcp   LISTEN 0      4096                                [::]:22            [::]:*    users:(("sshd",pid=1013,fd=4),("systemd",pid=1,fd=86))                                                                                                                                       
tcp   LISTEN 0      4096         [fd7a:115c:a1e0::f734:f152]:62586         [::]:*    users:(("tailscaled",pid=686,fd=30))                                                                                                                                                         
```

## db-core — DB listeners
```
Netid State  Recv-Q Send-Q                     Local Address:Port  Peer Address:PortProcess                                               
udp   UNCONN 0      0                                0.0.0.0:41641      0.0.0.0:*    users:(("tailscaled",pid=634,fd=18))                 
udp   UNCONN 0      0                             127.0.0.54:53         0.0.0.0:*    users:(("systemd-resolve",pid=461,fd=16))            
udp   UNCONN 0      0                          127.0.0.53%lo:53         0.0.0.0:*    users:(("systemd-resolve",pid=461,fd=14))            
udp   UNCONN 0      0                      10.1.10.210%ens18:68         0.0.0.0:*    users:(("systemd-network",pid=518,fd=24))            
udp   UNCONN 0      0                                   [::]:41641         [::]:*    users:(("tailscaled",pid=634,fd=27))                 
udp   UNCONN 0      0      [fe80::be24:11ff:fe46:4379]%ens18:546           [::]:*    users:(("systemd-network",pid=518,fd=23))            
tcp   LISTEN 0      200                            127.0.0.1:5432       0.0.0.0:*    users:(("postgres",pid=4263,fd=6))                   
tcp   LISTEN 0      200                          10.1.10.210:5432       0.0.0.0:*    users:(("postgres",pid=4263,fd=7))                   
tcp   LISTEN 0      4096                          127.0.0.54:53         0.0.0.0:*    users:(("systemd-resolve",pid=461,fd=17))            
tcp   LISTEN 0      200                         100.98.54.45:5432       0.0.0.0:*    users:(("postgres",pid=4263,fd=8))                   
tcp   LISTEN 0      4096                             0.0.0.0:22         0.0.0.0:*    users:(("sshd",pid=989,fd=3),("systemd",pid=1,fd=89))
tcp   LISTEN 0      4096                        100.98.54.45:35676      0.0.0.0:*    users:(("tailscaled",pid=634,fd=25))                 
tcp   LISTEN 0      4096                       127.0.0.53%lo:53         0.0.0.0:*    users:(("systemd-resolve",pid=461,fd=15))            
tcp   LISTEN 0      80                               0.0.0.0:3306       0.0.0.0:*    users:(("mariadbd",pid=893,fd=29))                   
tcp   LISTEN 0      4096                                [::]:22            [::]:*    users:(("sshd",pid=989,fd=4),("systemd",pid=1,fd=90))
tcp   LISTEN 0      4096         [fd7a:115c:a1e0::a334:362d]:55646         [::]:*    users:(("tailscaled",pid=634,fd=26))                 
```

