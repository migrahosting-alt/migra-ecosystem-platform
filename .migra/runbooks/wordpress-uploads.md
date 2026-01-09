# WordPress Upload Limits (413 Fix)

## Symptoms
- WordPress plugin/theme upload fails with **`413 Request Entity Too Large`**
- Common path: `/wp-admin/update.php?action=upload-plugin`

## Root Cause (Multi-layer)
A 413 can be enforced at multiple layers. For MigraHosting, the usual layers are:
1) **Edge NGINX on `srv1-web`** (vhost `client_max_body_size`)
2) **Pod NGINX inside the CloudPod** (often defaults to a small limit if not set)
3) **PHP-FPM inside the CloudPod** (`upload_max_filesize`, `post_max_size`)

If any layer is too small, uploads can fail.

## Platform Standard (WordPress)
Set these values to **256M**:
- NGINX: `client_max_body_size 256M;`
- PHP-FPM: `upload_max_filesize = 256M` and `post_max_size = 256M`

## Where We Apply It
### A) CloudPods (inside container)
- NGINX drop-in:
  - `/etc/nginx/conf.d/99-migra-upload.conf`
- PHP-FPM drop-in (all installed PHP versions):
  - `/etc/php/<version>/fpm/conf.d/99-migra-upload.ini`

### B) Edge vhosts on `srv1-web`
- Add `client_max_body_size 256M;` to the relevant `server {}` blocks.
  - This is required for sites served directly by `srv1-web` and for maintenance vhosts.

## Provisioning (Future Pods)
New CloudPods created via `pve:/usr/local/sbin/cloudpod-create.sh` apply the upload defaults automatically (best-effort) after netplan is configured.

## Validation
- Quick large-body POST test (5MB shown; increase if needed):
  - `dd if=/dev/zero bs=1M count=5 | curl -sk -o /dev/null -w "%{http_code}\n" -X POST --data-binary @- https://<domain>/`
- WordPress plugin upload should return `302` (redirect) or complete normally, not `413`.

## Provisioning Dry-Run (End-to-End)
This verifies that **new CloudPods** created by Proxmox automatically get the upload defaults.

### Preconditions
- Run on `pve` as root.
- Pick a **throwaway VMID** not in use (example uses `9199`).

### 1) Create a temporary CloudPod
```bash
cloudpod-create.sh --vmid 9199 --host wp-uploads-test --auto-ip --tenant DRYRUN-WP-UPLOADS
```

Capture the returned IP from the JSON output (field `ip`).

### 2) Validate defaults inside the container
```bash
pct exec 9199 -- bash -lc 'set -e; ls -l /etc/nginx/conf.d/99-migra-upload.conf || true; cat /etc/nginx/conf.d/99-migra-upload.conf || true'
pct exec 9199 -- bash -lc 'set -e; ls -1 /etc/php/*/fpm/conf.d/99-migra-upload.ini 2>/dev/null || true; for f in /etc/php/*/fpm/conf.d/99-migra-upload.ini; do echo "--- $f"; cat "$f"; done'
```

Expected:
- NGINX drop-in contains `client_max_body_size 256M;`
- PHP drop-in contains `upload_max_filesize = 256M` and `post_max_size = 256M`

### 3) Cleanup (destroy the temporary CloudPod)
```bash
pct stop 9199 || true
pct destroy 9199
```

Note: the IPAM file `pve:/etc/migra/ipam-cloudpods.txt` is append-only; if you want to reuse the allocated IP later, remove it manually.

## Rollback
- CloudPods: remove the two drop-ins and reload/restart services.
- Edge vhost: remove `client_max_body_size` and reload NGINX.
