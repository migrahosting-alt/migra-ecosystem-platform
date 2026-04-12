# Production Readiness

## Environment Variable Inventory

- `NODE_ENV`
  Expected to be `production` in deployed environments.
- No application secrets are required for the current public platform surface.
- Future API, auth, and downloads services should introduce server-only secrets through deployment-managed environment variables rather than checked-in config.

## Domain Assumptions

- Primary public domain: `https://migrateck.com`
- Staging validation domain: `https://staging.migrateck.com`
- Canonical route metadata assumes the primary domain above.
- Official product URLs in the registry may resolve to external product domains maintained across the MigraTeck ecosystem.

## Deployment Target Assumptions

- Deploy the Next.js web app in a Node-capable environment that supports Next.js 16 App Router runtime behavior.
- Serve the public site over HTTPS in front of the application runtime.
- Preserve response headers from the application middleware through any reverse proxy or CDN layer.
- Current edge host: `srv1-web` (`100.68.239.94`)
- Current live service: `migrateck.service` on `127.0.0.1:3111`
- Current staging service: `migrateck-staging.service` on `127.0.0.1:3112`
- Current staging nginx vhost: `/etc/nginx/sites-available/staging.migrateck.com.conf`
- Current staging backup snapshot: `/root/backups/migrateck-staging-edge-20260410T100750Z`

## Release Policy

- Do not overwrite `migrateck.com` directly for major platform rebuilds.
- Deploy major releases to a staging hostname first, validate there, and keep the current live runtime intact until staging passes.
- Prepare rollback commands and backup paths before any live cutover.
- Only schedule live cutover after staging smoke tests, header validation, and manual route checks pass.

## Security Header Expectations

- `Content-Security-Policy`
  Must be preserved end to end. The current implementation uses nonce-aware script controls and allows inline styles required by the framework/runtime.
- `Strict-Transport-Security`
  Should only be served on the live HTTPS domain.
- `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and `Cross-Origin-Resource-Policy`
  Should remain intact through the final edge/proxy layer.

## Post-Deploy Smoke Tests

1. Load `/`, `/products`, `/developers`, `/downloads`, and `/security` on the staging domain.
2. Verify security headers on the staging HTTPS domain with `curl -I`.
3. Confirm canonical metadata, `robots` behavior, and Open Graph tags render in the staging HTML.
4. Confirm all product logo paths resolve correctly from `/brands/products/...`.
5. Confirm `robots.txt`, `sitemap.xml`, `manifest.webmanifest`, and `/.well-known/security.txt` respond successfully.
6. Repeat the same checks on the live domain only after cutover is approved.
7. Run Lighthouse against the deployed HTTPS domain rather than the local development environment.

## Rollback Notes

- Live rollback posture is currently strong because the rebuilt platform is isolated on staging and `migrateck.com` still points at the existing `migrateck.service`.
- To roll back the staging release on `srv1-web`:
  - `systemctl stop migrateck-staging`
  - `systemctl disable migrateck-staging`
  - `rm -f /etc/nginx/sites-enabled/staging.migrateck.com.conf`
  - `cp /root/backups/migrateck-staging-edge-20260410T100750Z/sites-available/staging.migrateck.com.conf /etc/nginx/sites-available/` only if a prior staging config existed
  - `nginx -t && systemctl reload nginx`
- Do not modify `migrateck.service` or `/etc/nginx/sites-available/migrateck.com.conf` until staging is explicitly approved for live cutover.
- If a rollback is triggered by CSP/header issues, verify whether the edge layer is mutating response headers before reverting application code.
- If a rollback is triggered by route rendering regressions, prioritize restoring the last passing production build while preserving the canonical product registry and public asset directory.

## Current Validation Notes

- Local validation completed with `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm --filter @migrateck/web build`.
- Staging deployment is active at `https://staging.migrateck.com` on `srv1-web` without replacing the current live `migrateck.com` runtime.
- Manual staging browser screenshots were captured for homepage desktop/mobile, products, developers, and downloads.
- Staging metadata now renders with staging-host canonical URLs and `noindex,nofollow` behavior.
- Local and staging Lighthouse execution still returned `FAILED_DOCUMENT_REQUEST (net::ERR_ABORTED)` from the available runner, despite successful browser rendering and direct HTTPS responses. Treat Lighthouse score collection as still blocked until a stable runner environment is available.
