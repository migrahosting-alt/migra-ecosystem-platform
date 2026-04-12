# MigraDrive Beta Launch Checklist

## Go / No-Go Gates

### Provisioning
- Tenant is created on purchase.
- Tenant provisioning is idempotent.
- Upgrade updates quota correctly.
- Disable and reactivate both work.

### Bootstrap
- `/api/v1/drive/bootstrap` returns tenant, capabilities, operation policy, recent activity, and cleanup metadata.
- Bootstrap handles `ACTIVE`, `RESTRICTED`, `DISABLED`, and `PENDING` correctly.

### Workspace
- `/app/drive` loads without runtime errors.
- File list renders.
- Empty state renders.
- File actions work: upload, download, share, delete, cancel pending upload.

### State Enforcement
- `ACTIVE`: all supported actions enabled.
- `RESTRICTED`: upload, delete, and share blocked; read-only messaging visible.
- `DISABLED`: blocked access screen.
- `PENDING`: setup / provisioning screen.

### Storage
- Signed upload works.
- Signed download works.
- Expired URLs fail cleanly.
- Cross-tenant access is blocked.
- Multipart finalize works.

### Quota
- Upload is blocked when over quota.
- UI shows used storage percentage.
- Restriction is triggered on downgrade overflow.

### Security
- No mock routes available in production.
- Auth required for all drive APIs.
- Tenant isolation verified.
- Admin-only drive endpoints protected.

### Observability
- Logs include tenant context and action context.
- Errors are structured.
- Bootstrap, list, cleanup, download, share, delete, cancel, and upload actions are logged or metered.

## Beta Go Criteria

Launch only if all of the following are true:

- No data corruption path is known.
- No cross-tenant leak is reproducible.
- All tenant states enforce correctly.
- Storage signing and object access are reliable.
- Workspace E2E passes.
- Focused integration suite passes.

## Current Repo Coverage

- Focused route/integration coverage exists for bootstrap, product runtime, and mock storage.
- Playwright coverage exists for `/app/drive` load, file list, upload, download, share, cancel pending upload, and state-specific UI variants.
- Production storage validation still requires environment-backed execution outside this repo.