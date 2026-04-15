# MigraTeck Web Platform

Enterprise-grade Next.js foundation for `migrateck.com`, combining:

- Public marketing experience
- Authenticated platform app (`/app`)
- User + organization tenancy
- RBAC authorization
- Secure database sessions
- Audit logging and access controls
- Product entitlements and launch bridge readiness

## Phase 3 Highlights

- DB-backed platform switches (`PlatformConfig`) with OWNER-only control surface
- First-class entitlement lifecycle (`ACTIVE|TRIAL|RESTRICTED|INTERNAL_ONLY`) with dates/notes
- Organization invitations (create/list/revoke/resend/accept) with hashed tokens
- Product access request pipeline with audit and optional notification email
- Download center powered by `DownloadArtifact` + short-lived signed URL issuance
- Production downloads use real S3/MinIO SigV4 presigned URLs
- Audit export endpoint (`csv|json`) and in-app export panel

## Phase 4 Highlights

- Centralized entitlement enforcement in `src/lib/security/enforcement.ts` (`assertEntitlement`)
- Runtime feature gating moved to shared enforcement for launch/consume/download sign paths
- Platform lockdown controls (`maintenanceMode`, `freezeProvisioning`) with OWNER override
- Internal/client boundary checks codified (`isInternalOrg`) for `INTERNAL_ONLY` entitlement behavior
- Automatic entitlement expiry worker (`workers/entitlement-expiry.ts`) for trial/active downgrade to restricted
- Standardized audit envelope with actor/resource/risk-tier metadata for all audit writes

## Phase 5-7 Highlights

- Stripe webhook ingestion (`/api/billing/stripe/webhook`) with signature verification and deterministic entitlement sync
- Stripe webhook idempotency (`BillingWebhookEvent.eventId`) + stale-event guard for out-of-order delivery
- Billing subscription intelligence models (`BillingCustomer`, `BillingSubscription`, `BillingEntitlementBinding`)
- Provisioning queue + worker (`ProvisioningTask`, `workers/provisioning-engine.ts`) with entitlement-transition hooks
- Operator risk-tier gate (`Tier 0/1/2`) enforced for mutating routes via `assertMutationSecurity`
- Billing operations surface at `/app/billing` and platform binding API (`/api/platform/billing/bindings`)
- OWNER smoke-status endpoint (`/api/platform/smoke-status`) with Stripe + worker + queue telemetry

## Phase 8 Highlights

- Operations explorer UI at `/app/platform/ops` for OWNER + scoped org ADMIN
- Operations event explorer APIs:
  - `/api/platform/ops/events`
  - `/api/platform/ops/overview`
  - `/api/platform/ops/health`
- Filterable event drilldowns by org, actor, action, risk tier, route, and time range
- Worker dashboards with queue depth, oldest age, retries, dead-letter items, and worker heartbeat timestamps
- SLO visibility for webhook latency, provisioning completion time, and mutation denial rate by reason
- Optional alert webhook hooks for repeated failures and burst/block conditions (`OPS_ALERT_*`)

## Phase 9-10 Highlights

- Tier-2 mutation intents with payload-bound, single-use, short-lived enforcement (`MutationIntent`)
- Step-up policy for Tier-2 (`STEP_UP_TIER2=NONE|REAUTH|TOTP|PASSKEY`) with implemented `REAUTH` + `TOTP` and passkey scaffold
- Intent APIs:
  - `POST /api/security/intents`
  - `POST /api/security/totp/enroll`
  - `POST /api/security/totp/verify`
- Mutation guard now enforces Tier-2 intent consumption for critical routes
- Signed provisioning job envelopes (`ProvisioningJob`) with deterministic state machine:
  - `PENDING -> RUNNING -> SUCCEEDED|DEAD|CANCELED`
  - retry scheduling for retryable failures
- Job events (`ProvisioningJobEvent`) for forensic drilldown
- Ops job control APIs with Tier-2 intent gate:
  - `GET /api/platform/ops/jobs`
  - `POST /api/platform/ops/jobs/[id]/retry`
  - `POST /api/platform/ops/jobs/[id]/cancel`

## Stack

- Next.js App Router + TypeScript + Tailwind CSS
- Framer Motion (marketing motion system)
- Auth.js (NextAuth) + Prisma Adapter
- PostgreSQL + Prisma ORM
- Argon2id password hashing
- Zod schema validation
- Local Postfix/sendmail relay for auth and transactional email delivery

## Route Surfaces

### Public routes

- `/`
- `/platform`
- `/products`
- `/developers`
- `/company`
- `/login`
- `/signup`
- `/verify-email`
- `/forgot-password`
- `/reset-password`
- `/invite`
- `/request-access`

### App routes

- `/app`
- `/app/orgs`
- `/app/orgs/[orgId]/settings`
- `/app/orgs/[orgId]/entitlements`
- `/app/products`
- `/app/downloads`
- `/app/audit`
- `/app/platform/settings`
- `/app/platform/ops`

### API routes

- `/api/auth/*`
- `/api/orgs/*`
- `/api/orgs/[orgId]/entitlements`
- `/api/orgs/[orgId]/invites`
- `/api/orgs/[orgId]/invites/[id]`
- `/api/orgs/[orgId]/invites/[id]/resend`
- `/api/products/*`
- `/api/products/request-access`
- `/api/downloads/*`
- `/api/download/[artifactId]`
- `/api/downloads/[artifactId]/sign`
- `/api/billing/stripe/webhook`
- `/api/billing/subscriptions`
- `/api/platform/billing/bindings`
- `/api/platform/smoke-status`
- `/api/platform/ops/events`
- `/api/platform/ops/overview`
- `/api/platform/ops/health`
- `/api/platform/ops/jobs`
- `/api/platform/ops/jobs/[id]/retry`
- `/api/platform/ops/jobs/[id]/cancel`
- `/api/security/intents`
- `/api/security/totp/enroll`
- `/api/security/totp/verify`
- `/api/audit/*`
- `/api/audit/export`
- `/api/platform/config`
- `/api/invites/accept`

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Configure env vars:

```bash
cp .env.example .env
```

3. Start the local database:

```bash
npm run db:ensure
```

4. Apply the schema locally:

```bash
npm run db:prepare
```

5. Seed local data:

```bash
npm run prisma:seed
```

6. Start dev server:

```bash
npm run dev
```

## Integration Tests

`Vitest` integration tests run against a real Next.js server and Postgres schema.

1. Optional: configure `DATABASE_URL_TEST` in `.env` to use a dedicated local Postgres database.
2. If `DATABASE_URL_TEST` is not set, the harness starts an ephemeral Postgres container via `@testcontainers/postgresql`.
3. Run:

```bash
npm run test:integration
```

Coverage currently includes:

- Auth: custom `/api/auth/login`, verified-email enforcement, verify-email, reset-password session invalidation
- Tenancy + RBAC: org boundary deny paths and deny audit entries
- Product launch + consume: entitlement gates, `aud` checks, nonce replay protection, expiry rejection
- CSRF: same-origin enforcement on mutating routes
- Rate limits: threshold rejection and stale event cleanup path
- Platform config OWNER controls + deny auditing
- Platform smoke status OWNER-only visibility + deny auditing
- Entitlements update RBAC + launch gating behavior
- Invitation create/accept/replay denial behavior
- Product access requests + CSRF rejection behavior
- Download listing/sign entitlement gates
- Audit export role gates for CSV/JSON

Note: The harness seeds DB-backed session cookies for authenticated endpoint tests. This avoids relying on `next-auth` credentials callback paths while session strategy is database-backed.

## Production Service

The tracked production unit for `srv1-web` lives at [deploy/migrateck.service](/home/bonex/workspace/active/MigraTeck-Ecosystem/dev/MigraTeck/deploy/migrateck.service). It runs the compiled public `apps/web` Next.js app from `/opt/migra/repos/migrateck/app/apps/web` with the package-local Next.js binary on `127.0.0.1:3111`, loads `/etc/migrateck/migrateck.env` when present, and avoids the extra `npm` wrapper process that makes shutdown and restart behavior noisier under systemd.

Important: `migrateck.com` is served from `apps/web`. The repo-root Next.js app under `src/` is not the tracked public-site deployment target, so do not validate live-site changes with `npx next dev` from the repo root.

Local public-site workflow:

```bash
npm run dev:web
npm run build:web
```

Remote sync, rebuild, and restart on `srv1-web`:

```bash
DEPLOY_SYNC_REMOTE=true DEPLOY_HOST=srv1-web npm run ops:deploy:production
```

Useful flags:

- `DEPLOY_USER=root`
- `DEPLOY_SSH_PORT=22`
- `DEPLOY_REMOTE_DIR=/opt/migra/repos/migrateck/app`
- `DEPLOY_SERVICE=migrateck`
- `DEPLOY_RSYNC_DELETE=true`
- `DEPLOY_RUN_SMOKE=true DEPLOY_SMOKE_URL=https://migrateck.com`

## Security Defaults

- Argon2id password hashing
- Rate limiting on auth-sensitive endpoints
- Email verification flow
- Password reset tokens
- Database-backed session revocation (`logout all`)
- CSP/HSTS/XFO/referrer security headers
- Audit trail for auth/org/access events
- Same-origin CSRF checks on mutating API routes
- Launch tokens with `aud`, `nonce`, `iat`, `exp` and 60-second TTL
- Dedicated `LAUNCH_TOKEN_SECRET` for product launch bridge signing
- Password auth uses custom `/api/auth/login` with DB-backed `Session` row creation and HttpOnly session cookies
- Password auth also issues short-lived bearer access tokens plus hashed DB-backed refresh sessions for `/api/auth/refresh`
- Auth API surface includes `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/refresh`, and `/api/auth/me`
- `/api/auth/login` responses are marked `Cache-Control: no-store`
- CSRF guard supports explicit production allowlists (`SECURITY_ALLOWED_ORIGINS`, `SECURITY_ALLOWED_HOSTS`)
- Platform switches are DB-backed (`PlatformConfig`, singleton id `default`)
- Invitation tokens are random + hashed at rest (`OrgInvitation.tokenHash`)
- Download URLs are issued via short-lived signer abstraction (`DOWNLOAD_URL_TTL_SECONDS`)
- Audit exports are role-gated (`audit:export`) and export events are audited (`AUDIT_EXPORT_CREATED`)
- Central enforcement (`assertEntitlement`) is used for launch, consume, and download URL issuance
- Platform lockdown switches are DB-backed (`PlatformConfig.maintenanceMode`, `PlatformConfig.freezeProvisioning`)
- Audit entries include standardized metadata envelope with `riskTier` (`0` read, `1` normal mutation, `2` high impact)
- Stripe webhook payloads are HMAC-verified before processing (`stripe-signature`)
- Stripe webhooks are replay-safe (`event.id` dedupe) and stale updates are ignored
- Billing events map subscription state into `OrgEntitlement` status transitions
- Provisioning actions are queued and processed asynchronously from `ProvisioningTask`
- Mutation paths enforce explicit risk tiers with deny auditing (`AUTHZ_RISK_TIER_DENIED`)

## Security Checklist

- Email verification token TTL: 24 hours, single-use, hashed at rest
- Password reset token TTL: 30 minutes, single-use, hashed at rest
- Login requires verified email by default (`ENFORCE_EMAIL_VERIFIED_LOGIN=true`)
- Session cookies are `HttpOnly` + `Secure` (prod) + `SameSite=Lax`
- Refresh cookies are `HttpOnly` and scoped to `/api/auth`; refresh tokens are stored hashed in `RefreshSession`
- Canonical password-login cookie is `next-auth.session-token` (`__Secure-next-auth.session-token` on HTTPS)
- Password reset invalidates all active DB sessions
- Password login enforces max 20 active sessions per user (oldest sessions pruned)
- Rate limits:
  - `auth:login`: 10 attempts / 10 min
  - `auth:signup`: 5 attempts / 60 min
  - `auth:request-password-reset`: 6 attempts / 60 min
  - `auth:verify-email`: 12 attempts / 60 min
  - `auth:reset-password`: 8 attempts / 30 min
  - `product:launch`: 20 attempts / 60 sec
- Authorization uses central `can(role, action)` map
- Permission denials are written to `AuditLog` (`AUTHZ_PERMISSION_DENIED`)
- Launch nonces are stored in DB (`LaunchTokenNonce`) for one-time consumption

## Ops Runbook

1. Configure `.env` with production values (`NEXTAUTH_SECRET` and `LAUNCH_TOKEN_SECRET` must be different).
   - For bearer auth + refresh rotation also set `AUTH_ACCESS_TOKEN_SECRET`, `AUTH_ACCESS_TOKEN_TTL_SECONDS`, `AUTH_REFRESH_TOKEN_TTL_DAYS`, `AUTH_COOKIE_NAME`, `AUTH_COOKIE_SECURE`, and `AUTH_COOKIE_DOMAIN`.
2. Run `npm run prisma:generate`.
3. Apply migrations with `npm run prisma:migrate` (or your CI migration step).
4. Deploy app, then validate:
   - signup -> verify -> login
   - register/signup creates `OrgEntitlement(MIGRADRIVE=ACTIVE)` plus a starter `DriveTenant(PENDING)` bootstrap path
   - `/api/auth/refresh` rotates the refresh cookie and returns a fresh bearer access token
   - password reset invalidates existing sessions
   - org switch denies non-members
   - product launch token issuance appears in audit
   - platform switches (`/app/platform/settings`) enforce signup/org-create policy
   - org invite create/accept flow works for ADMIN/OWNER
   - entitlement edits in `/app/orgs/[orgId]/entitlements` reflect in launch/download gates
   - audit export (`/api/audit/export`) succeeds for OWNER/ADMIN and denies MEMBER
5. Rotation strategy:
   - rotate `NEXTAUTH_SECRET` and `LAUNCH_TOKEN_SECRET` independently
   - invalidate sessions on auth secret rotation

## Phase 3 Runbook

1. Seed/update singleton platform config (id `default`) before opening signup:
   - `allowPublicSignup=true|false`
   - `allowOrgCreate=true|false`
   - `waitlistMode=true|false`
2. Publish download artifacts (`DownloadArtifact`) for each product/version you want visible in `/app/downloads`.
3. Configure signing provider env for production:
   - `DOWNLOAD_STORAGE_PROVIDER=s3|minio`
   - `UPLOAD_STORAGE_PROVIDER=s3|minio`
   - `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
   - In the Migra ecosystem, prefer the generated `migrateck-app.env` fragment from `infra/enterprise/storage/bootstrap-migradrive-ecosystem.sh` so production points at `https://s3.migradrive.com` with the scoped `migrateck-app` credential.
4. Configure MigraDrive production storage separately from generic download artifacts when using the multi-bucket profile:
   - `MIGRADRIVE_S3_ENDPOINT`, `MIGRADRIVE_S3_REGION`, `MIGRADRIVE_S3_ACCESS_KEY_ID`, `MIGRADRIVE_S3_SECRET_ACCESS_KEY`
   - `MIGRADRIVE_S3_BUCKET_PRIMARY`, `MIGRADRIVE_S3_BUCKET_DERIVATIVES`, `MIGRADRIVE_S3_BUCKET_ARCHIVE`, `MIGRADRIVE_S3_BUCKET_LOGS`
   - `MIGRADRIVE_SIGNED_URL_TTL_SECONDS=900`
   - `MIGRADRIVE_MULTIPART_MIN_PART_SIZE_MB=8`
   - `MIGRADRIVE_MAX_UPLOAD_SIZE_MB=5120`
   - Canonical live object keys now use `tenants/{tenantId}/files/{fileId}/v1`; metadata rename/move no longer rewrites object keys.
5. Optional access request notifications:
   - `ACCESS_REQUEST_NOTIFY_EMAIL=true`
   - `ACCESS_REQUEST_NOTIFY_TO=services@migrateck.com`
6. Verify invitation delivery behavior:
   - SMTP + magic links enabled: invitation email sent
   - SMTP disabled: invite link returned for manual sharing in settings UI

## Phase 4 Runbook

1. Manage emergency switches in `/app/platform/settings`:
   - `maintenanceMode=true`: block mutating operations except OWNER override
   - `freezeProvisioning=true`: block provisioning-sensitive actions (`org:create`, invite create/revoke/resend, pod-create class actions)
   - `pauseProvisioningWorker=true`: stop background provisioning execution without redeploy
   - `pauseEntitlementExpiryWorker=true`: stop automatic entitlement expiry transitions without redeploy
2. Ensure entitlement updates respect internal/client boundaries:
   - `INTERNAL_ONLY` status is only valid for internal orgs (`slug` starts with `migra`)
3. Operate entitlement expiry automation:
   - Worker source: `workers/entitlement-expiry.ts`
   - Interval: every 10 minutes
   - Behavior: expired `TRIAL|ACTIVE` => auto-transition to `RESTRICTED` + audit (`ORG_ENTITLEMENT_AUTO_RESTRICTED`)
4. Download protection flow:
   - Never expose static direct links
   - Use `POST /api/downloads/[artifactId]/sign` (or alias `POST /api/download/[artifactId]`) to issue short-lived signed URL

## Phase 5-7 Runbook

1. Configure Stripe billing intelligence:
   - `STRIPE_BILLING_ENABLED=true`
   - `STRIPE_SECRET_KEY=sk_live_...` (production) or `sk_test_...` (test environments)
   - `STRIPE_WEBHOOK_SECRET=...`
   - Ensure Stripe subscriptions include `metadata.orgId`
   - Webhook mode mismatch (live/test) is rejected when `STRIPE_SECRET_KEY` is set
2. Configure price-to-product mapping (OWNER):
   - `POST /api/platform/billing/bindings`
   - payload: `externalPriceId`, `product`, optional `statusOnActive`
3. Validate subscription sync:
   - Stripe event `customer.subscription.updated` => `BillingSubscription` upsert + `OrgEntitlement` sync + audits
4. Run provisioning engine:
   - worker source: `workers/provisioning-engine.ts`
   - `RUN_PROVISIONING_ENGINE_WORKER=true`
   - default dry run (`PROVISIONING_ENGINE_DRY_RUN=true`) for safe rollout
5. Risk-tier policy:
   - Tier 0: read
   - Tier 1: standard mutation
   - Tier 2: high impact mutations (e.g., entitlement edits, platform config)
6. Post-deploy control plane probe:
   - `GET /api/platform/smoke-status` (OWNER-only)
   - Returns Stripe readiness, last webhook event, worker enabled/paused state, queue depth, and oldest queued-job age

## Phase 8 Runbook

1. Open `/app/platform/ops` with OWNER or org ADMIN role.
2. Open `/app/platform/migradrive/tenants` for the internal MigraDrive Ops console.
3. Use `/app/platform/migradrive/storage-health`, `/app/platform/migradrive/operations`, and `/app/platform/migradrive/reconciliation` for backend diagnostics.
4. Filter `/app/platform/ops` by `orgId`, `actorId`, `action`, `riskTier`, `route`, and time window for incident triage.
5. Use drilldown tables to inspect webhook events and provisioning runs.
6. Integrate health/SLO probes:
   - `GET /api/platform/ops/overview?orgId=...`
   - `GET /api/platform/ops/events?orgId=...`
   - `GET /api/platform/ops/health?orgId=...`
7. Configure optional alert hooks and thresholds via `OPS_ALERT_WEBHOOK_URL`, `OPS_ALERT_WEBHOOK_TOKEN`, and `OPS_ALERT_*` threshold vars.

## Phase 9-10 Runbook

1. Configure Tier-2 policy:
   - `STEP_UP_TIER2=NONE|REAUTH|TOTP|PASSKEY`
   - `STEP_UP_TIER2_TTL_SECONDS=300`
2. For `TOTP` step-up:
   - Set `STEP_UP_TOTP_ENCRYPTION_KEY`
   - Enroll and verify via `/api/security/totp/enroll` and `/api/security/totp/verify`
3. Tier-2 mutation flow:
   - Create intent: `POST /api/security/intents`
   - Execute mutation with `intentId` in request body
4. Signed job envelopes:
   - Set `JOB_ENVELOPE_SIGNING_SECRET` (required in production)
   - Tune `PROVISIONING_JOB_DEFAULT_MAX_ATTEMPTS` + `PROVISIONING_JOB_BACKOFF_BASE_SECONDS`
5. Dead-letter operations:
   - List: `GET /api/platform/ops/jobs`
   - Retry/cancel with Tier-2 intent through ops UI (`/app/platform/ops`) or APIs
6. Production hard requirements enforced by predeploy checks:
   - `DOWNLOAD_STORAGE_PROVIDER` must be set and cannot be `mock`
   - `DOWNLOAD_URL_TTL_SECONDS` must be set (range `60-3600`)
   - `JOB_ENVELOPE_SIGNING_SECRET` must be set (min length `32`)

## Ops Scripts

- Pre-deploy guard checks:

```bash
npm run ops:predeploy-check
```

- Standard production deploy workflow:

```bash
npm run ops:deploy:production
```

- Post-deploy auth smoke flow:

```bash
BASE_URL="https://migrateck.com" npm run ops:smoke-auth

SMOKE_EXPECT_SIGNUP_DISABLED=true BASE_URL="https://migrateck.com" npm run ops:smoke-auth
```

Notes:
- `ops:predeploy-check` validates required secrets, CSRF allowlists, SMTP toggles, DB index expectations, and production URL/HTTPS posture.
- `ops:predeploy-check` flags:
  - `REQUIRE_PRODUCTION=true|false` (default `true`)
  - `ALLOW_WILDCARD_HOSTS=true|false` (default `false`; only affects host validation)
  - `SKIP_DB_INDEX_CHECK=true|false` (default `false`)
- `ops:smoke-auth` runs `/api/auth/csrf` probe -> signup/closed-signup validation -> verify (when signup is open) -> login -> refresh -> logout-all -> refresh/session invalidation checks -> entitlement launch -> CSRF-negative checks using real HTTP.
- `ops:smoke-auth` verification modes:
  - default deterministic mode: DB-assisted token insertion
  - SMTP mode: `SMOKE_USE_SMTP=true` plus either `SMOKE_VERIFY_TOKEN` or `SMOKE_VERIFY_TOKEN_CMD`
   - closed-signup production mode: `SMOKE_EXPECT_SIGNUP_DISABLED=true` asserts the expected `403` and seeds a disposable verified user/org via Prisma for the remaining auth probes
- `ops:deploy:production` supports:
  - `DEPLOY_RESTART_CMD`: service restart command (required for full automated rollout)
  - `DEPLOY_RUN_TESTS=true`: run integration suite during deploy
  - `DEPLOY_RUN_SMOKE_AUTH=true BASE_URL=https://...`: execute smoke flow after restart
  - `DEPLOY_SKIP_DB_INDEX_CHECK=true`: bypass DB index probe when runner cannot reach DB

## Branding

Logo source is copied from:

- `New Migra-Panel/official-logos/MigraTeck_official_logo.png`

and served at:

- `public/brand/migrateck-logo.png`
