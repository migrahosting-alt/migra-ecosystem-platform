# Runbook: MigraPanel Files to MigraDrive

Scope: `srv1-web` file plane for MigraPanel tenant content
Risk: HIGH if cut over directly, MED when using a staged hybrid bridge

## Current Live State

- The live files plane is the `migrapanel-files-agent.service` systemd unit on `srv1-web`.
- The agent runs from `/opt/MigraPanel/apps/files-agent/server.js`.
- The repo-tracked source now lives at `migra-infra/servers/srv1-web/apps/migrapanel-files-agent`.
- The backend is live in `hybrid` mode:
  - base path: `/srv/web/clients`
  - service user: `www-data`
  - systemd write scope: `ReadWritePaths=/srv/web/clients`
  - remote endpoint: `https://s3.migradrive.com`
  - remote bucket: `migrapanel-files`
  - remote prefix: `tenants`
- The current API surface is the internal files endpoints under `/internal/files/*`.
- New writes now dual-write to local disk and MigraDrive.
- Reads prefer MigraDrive and fall back to local disk for not-yet-migrated content.
- The one-time population job is `node backfill-migradrive.js` from `/opt/MigraPanel/apps/files-agent`.
- The managed backfill wrapper is `/opt/MigraPanel/apps/files-agent/run-backfill-migradrive.sh`.
- The managed service unit is `migrapanel-files-backfill.service`.
- Backfill logs live under `/var/log/migrapanel-files-agent/backfill-*.out` and manifests under `/var/log/migrapanel-files-agent/backfill-*.jsonl`.

## Required Target State

- MigraPanel keeps its authenticated internal files API.
- Blob storage moves to the canonical MigraDrive app account:
  - endpoint: `https://s3.migradrive.com`
  - bucket: `migrapanel-files`
  - account: `migrapanel-app`
- WordPress and NGINX tenant automation can still read local site roots where needed.
- Browser and panel uploads should use presigned URLs or server-side streamed uploads instead of raw long-lived S3 credentials.

## Enterprise Migration Path

1. Keep the storage abstraction in the files agent.
- The agent now supports `MPANEL_FILES_BACKEND=filesystem|hybrid|migradrive`.
- `hybrid` is the live default until backfill and tenant verification are complete.
- MigraDrive object keys are deterministic under the `tenants/` prefix.

2. Introduce canonical object keys.
- Prefix every tenant under `tenants/<tenant-id-or-domain>/...`.
- Preserve stable relative paths so API consumers do not need to change URL semantics.
- Store metadata needed for reverse mapping if a tenant is renamed.

3. Run in hybrid mode first.
- New writes go to MigraDrive and local disk.
- Reads try MigraDrive first, then fall back to local disk.
- Deletes remove both the remote object tree and the local mirror.

4. Backfill existing local files.
- Inventory `/srv/web/clients`.
- Sync tenant directories into `migrapanel-files`.
- Persist a JSONL manifest with path, object key, size, checksum, action, and timestamped run file.
- Skip already-migrated objects when size and SHA-256 match.
- Create `.migra-folder` markers so empty directories survive the migration.

5. Cut traffic to MigraDrive after verification.
- Verify tenant reads from the panel.
- Verify upload, download, rename, and delete semantics.
- Keep local disk as a short retention mirror until rollback confidence is no longer needed.

6. Retire local-primary mode.
- Change systemd write access from `/srv/web/clients` to a smaller bridge/cache path if still needed.
- Keep `wp-agent` and tenant automation on local site roots only for workloads that truly require direct filesystem access.

## Why Hybrid Is Required

- MigraPanel currently manages live tenant web roots, not only detached file assets.
- Some workloads still need direct filesystem access for WordPress, deploy hooks, and static site roots.
- A direct switch from `/srv/web/clients` to S3 would break those expectations.
- Hybrid mode lets user-managed files move to object storage without breaking tenant runtime paths.

## Recommended Implementation Split

- Keep `wp-agent` focused on WordPress operations on tenant roots.
- Keep `edge-agent` focused on NGINX and tenant edge controls.
- Upgrade `files-agent` into a storage broker:
  - local filesystem adapter
  - MigraDrive adapter
  - sync/backfill worker
  - manifest tracking

## Verification Checklist

- `systemctl status migrapanel-files-agent.service --no-pager`
- `curl -fsS http://127.0.0.1:3180/internal/files/health`
- list a tenant path through the panel API
- upload a test file through the panel
- confirm the object exists in `migrapanel-files`
- download the same file back through the panel
- rename and delete the file through the panel
- confirm fallback still works for unmigrated local files
- monitor active backfill with:

```bash
ssh srv1-web 'sudo tail -f /var/log/migrapanel-files-agent/backfill-*.out'
```

- inspect the latest manifest summary with:

```bash
ssh srv1-web 'sudo tail -n 5 /var/log/migrapanel-files-agent/backfill-*.out'
```

## Rollback

- Set `MPANEL_FILES_BACKEND=filesystem`
- restart `migrapanel-files-agent.service`
- keep the migrated objects in MigraDrive; do not delete them during rollback

## Source Of Truth

- Operational storage baseline: `infra/enterprise/storage/MIGRADRIVE_OPERATOR_ROLLOUT.md`
- MigraDrive platform contract: `infra/enterprise/storage/MIGRADRIVE_FOUNDATION.md`
- MigraPanel runtime notes: `.migra/runbooks/migrapanel-ops.md`
