# Pale Control Center — Implementation Blueprint

**Product:** MigraPanel → Pale (internal: "Pale Control Center")
**Date:** 2026-06-12
**Status:** Blueprint only. No code beyond the existing read-only `/console/pale` tile + overview page. **Do not build until reviewed.**

> **Routing note:** the live console is served at `console.migrateck.com/console`, so
> all real routes use the **`/console/pale/*`** prefix, not `/panel/pale/*`. The
> spec's `/panel/pale/*` is treated as the logical name; the physical map below
> uses `/console/pale/*` to match the deployed app and the module already shipped.

---

## 0. Critical architecture finding — the staff auth bridge

This is the single most important design decision and must be settled before Phase 1.

- **pale-api** (`/opt/pale/backend`, NestJS, app-core `127.0.0.1:4005`, base `/api`)
  already exposes an admin API at **`/api/v1/admin/*`** guarded by `JwtAuthGuard` +
  `RolesGuard`, expecting a **Pale user JWT** whose user holds a staff `RoleKey`
  (`moderator` / `trust_safety_admin` / `platform_admin`) via `UserRole`.
- **MigraPanel console** authenticates with its **own** single-admin, env-gated
  session (`console/lib/auth.getSession`). It is **not** a Pale JWT. **No bridge
  exists today** for the console to call pale-api's admin endpoints.

**Recommended bridge (server-to-server, never in the browser):**
The console SSR runs on app-core, colocated with pale-api. The console backend
should call `http://127.0.0.1:4005/api/v1/admin/*` using a **dedicated staff
service credential**, mapping the logged-in console admin to a pale staff actor:

- Add a pale-api **service-auth path**: an internal `X-Pale-Service-Key` (shared
  secret in `/etc/.../pale-service.key`, env on both sides) **OR** a short-lived
  staff JWT the console mints with a shared secret + an `actorUserId`/`actorRole`
  claim. The Pale `SessionType.staff` value and `Role.is_staff_role` flag already
  anticipate staff sessions.
- The console passes the **acting console admin's identity** (id + role) so
  pale-api's `AuditService` records the real human actor, not a generic service.
- All calls stay server-side (SSR/route handlers); the browser never holds a Pale
  token. This matches the existing "deep-link, no tokens in URLs" posture.

Until the bridge exists, Phase 1 can only show data pale-api is willing to serve
to the service credential. **Design the bridge first.**

---

## 1. Existing backend capabilities (verified in `Software/Pale/backend`)

**Admin / moderation API** — `@Controller("v1/admin")`, `@UseGuards(JwtAuthGuard, RolesGuard)`, `@Roles(moderator, trust_safety_admin, platform_admin)`:

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/admin/reports` | Report queue (filterable by status) |
| `GET /v1/admin/reports/:id` | Report detail |
| `PATCH /v1/admin/reports/:id/status` | Update report status (audited) |
| `POST /v1/admin/reports/:id/action` | Take action on a report (audited) |
| `GET /v1/admin/users` | User search/filter (incl. by role) |
| `GET /v1/admin/users/:id` | User detail |
| `POST /v1/admin/users/:id/suspend` | Suspend (audited) |
| `POST /v1/admin/users/:id/ban` | Ban (audited) |
| `POST /v1/admin/users/:id/restore` | Restore (audited) |
| `GET /v1/admin/audit-logs` | Audit log query |

- **Audit is already wired**: `admin-moderation.service` calls `AuditService.record()`
  for every mutation (`REPORT_STATUS_UPDATED`, `REPORT_ACTION_TAKEN`, `USER_SUSPENDED`,
  `USER_BANNED`, `USER_RESTORED`).
- **RBAC primitives**: `Role`, `UserRole`, `RoleKey` enum (`member`, `moderator`,
  `trust_safety_admin`, `platform_admin`), `RolesGuard`, `@Roles()` decorator,
  `RbacService`, `roles.guard.test.ts`.
- **Models present**: `User` (`accountStatus`: active/suspended/banned/deactivated,
  `phoneVerifiedAt`, `ageConfirmedAt`, `deletedAt`), `Report` (targetType/targetId,
  reason, details, status enum pending/reviewing/reviewed/dismissed/actioned/escalated,
  actionTaken, reviewedBy/At), `AuditLog` (actor, action, target, requestId, route,
  ipHash, metadata), `Session` + `Device` + `DeviceVoipToken` (session/device control),
  `UserBlock`, `OtpVerification`, `FeedbackSubmission`, `GroupBan`, `Status`, `Message`,
  `MediaAsset` (+ `MediaScanStatus`).
- **Self-service account deletion**: `POST /v1/settings/account/delete/request`,
  `DELETE /v1/settings/account/delete/confirm` (user-initiated, not admin).
- **Today's auth work** (live): one-account-per-number (E.164 canonicalization +
  `User.phoneNumber @unique`) and one-active-device (login revokes prior sessions;
  `JwtStrategy` checks `session.revokedAt` per request).

## 2. Missing backend capabilities

| Capability | Status |
| --- | --- |
| **Tickets** (threaded support cases w/ replies, assignment, status, links) | **Missing.** `FeedbackSubmission` is one-way feedback, not a ticket thread. New model + API. |
| **Appeals & Claims** (ban/suspension/content/ownership) | **Missing.** No model/API. New. |
| **OTP delivery dashboard** | **Partial.** Prod uses Telnyx Verify → no local OTP rows; only reliability log events (`auth.otp.sent`, `auth.otp.delivery_failed`) exist, not queryable. Need an OTP-delivery-event store and/or a masked Telnyx Verify status proxy. |
| **Admin account control beyond suspend/ban/restore**: force-logout, revoke-sessions, admin-initiated start/cancel deletion, mark-compromised, add admin note | **Missing as admin endpoints** (session-revoke logic exists internally). |
| **Releases / version registry** + min-supported-version + strict-media flag readout | **Missing.** App reports `appVersion` on login (stored on `Device`); no release registry/config. |
| **RBAC roles for the 6-role model** (Owner, Admin, Support Agent, Read-only Auditor) | **Partial.** Only 3 staff roles exist. Need `support_agent` + `auditor` (and an Owner/Admin split or convention). |
| **Case-gated private-content evidence view** (review a reported message only via a case) | **Missing as a dedicated audited endpoint.** `Report` links `messageId`/`conversationId`, but a controlled, audited "evidence fetch" endpoint is required to satisfy the no-casual-browsing rule. |
| **Report categorization** into the 10 requested queues | **Partial.** `Report.targetType`/`reason` are free-text; filterable now, but a typed `reportType` improves queues. |
| **Console ↔ pale-api staff service bridge** | **Missing.** See §0. |

## 3. MigraPanel route map (physical `/console/pale/*`)

| Route | Screen | Min role |
| --- | --- | --- |
| `/console/pale` | Overview dashboard (exists, read-only) | Auditor+ |
| `/console/pale/users` | User search/filter | Support+ |
| `/console/pale/users/:id` | User detail + actions | Support+ (mutations gated) |
| `/console/pale/reports` | Report queue (10 category tabs) | Moderator+ |
| `/console/pale/reports/:id` | Report detail + case-gated evidence + actions | Moderator+ |
| `/console/pale/tickets` | Support queue | Support+ |
| `/console/pale/tickets/:id` | Ticket thread + actions | Support+ |
| `/console/pale/appeals` | Appeals/claims queue | T&S Manager+ |
| `/console/pale/appeals/:id` | Appeal/claim detail + decision | T&S Manager+ |
| `/console/pale/otp` | OTP delivery health (masked) | Support+ |
| `/console/pale/releases` | Version/release status | Admin+ (read: Auditor+) |
| `/console/pale/audit-logs` | Audit log viewer | Auditor+ |
| `/console/pale/settings` | Trust/safety + module settings | Admin+ |

## 4. Screen-by-screen UI plan

- **Overview** — tiles: total users, new signups, DAU, pending reports, open
  tickets, pending appeals, banned/suspended count, OTP failures, current app
  version, backend health (live probe — already built), private-media strict-mode
  flag. Numbers come from new aggregate endpoints; anything not yet wired shows an
  honest "not connected" state (never a fabricated count — matches the AnnouPale bar).
- **Users** — search by phone/name/username/id/country/status/signup/last-active;
  detail tabs: profile, phone verification, age confirmation, account status,
  devices/sessions, groups, reports filed, reports against, tickets, appeals, admin
  notes, audit history. Actions (RBAC + confirm-gated): suspend, ban, restore, force
  logout, revoke sessions, start/cancel deletion, mark compromised, add note.
- **Reports** — 10 category tabs (message/profile/group/status/media/call-abuse/
  spam-scam/harassment/impersonation/illegal). Detail shows reporter, target,
  reason, and **case-gated evidence** (the specific reported content only). Actions:
  assign, review, dismiss, warn, remove content, hide status, suspend, ban, escalate,
  resolve.
- **Tickets** — queue by type (login/OTP, phone change, recovery, blocked, deletion
  help, bug, media, call, general). Thread view with reply, assign, close, escalate,
  link report/appeal/user, internal note.
- **Appeals & Claims** — ban/suspension/content/impersonation/ownership (account/
  phone/business). Actions: approve, deny, restore account/content, request evidence,
  escalate, uphold.
- **OTP delivery** — rows: destination country, **masked** phone, provider, route,
  status, failure code, latency, retry count, timestamp. **Never show codes.**
  Actions: resend-if-allowed, view provider status, mark provider incident.
- **Releases** — latest Android, Play internal-testing, (Migra Cloud later), min
  supported, release notes, private-media strict flag, backend version.
- **Audit logs** — admin, role, action, target, before/after, reason, timestamp,
  IP-hash/session. Read-only, filterable.

## 5. RBAC permission matrix (6 roles → pale `RoleKey`)

Mapping to existing `RoleKey` enum, adding `support_agent` + `auditor`:

| Capability | Owner | Admin | T&S Manager | Moderator | Support | Auditor |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| View overview / audit logs / case history | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| User lookup | ✓ | ✓ | ✓ | ✓ | ✓ | view |
| Tickets (reply/assign/close) | ✓ | ✓ | ✓ | — | ✓ | — |
| OTP delivery status (masked) | ✓ | ✓ | ✓ | — | ✓ | view |
| Non-destructive account help | ✓ | ✓ | ✓ | — | ✓ | — |
| Review reports / remove reported content | ✓ | ✓ | ✓ | ✓ | — | — |
| Warn / suspend (where allowed) | ✓ | ✓ | ✓ | ✓* | — | — |
| Appeals & restrictions | ✓ | ✓ | ✓ | — | — | — |
| Ban / restore | ✓ | ✓ | ✓ | — | — | — |
| Force logout / revoke sessions | ✓ | ✓ | ✓ | — | help-only | — |
| Start/cancel deletion, mark compromised | ✓ | ✓ | T&S only | — | — | — |
| Release controls | ✓ | ✓ | — | — | — | view |
| Trust/safety settings | ✓ | ✓ | partial | — | — | — |
| Any mutation | ✓ | ✓ | ✓ | ✓* | ✓(non-destructive) | **never** |

`RoleKey` mapping: Owner+Admin → `platform_admin` (distinguish Owner via a
`is_owner` flag or a dedicated `owner` enum value); T&S Manager → `trust_safety_admin`;
Moderator → `moderator`; Support Agent → **new** `support_agent`; Read-only Auditor →
**new** `auditor`. `*` Moderator suspend is policy-gated.

## 6. Audit-log requirements

- **Every mutation writes an `AuditLog`** via the existing `AuditService` (already
  true for the current admin endpoints; extend to all new mutations).
- Record **before/after state** for status-changing actions (add `metadata.before`
  / `metadata.after` — the model's `metadata Json?` already supports this).
- Capture **actor (real human), role, action, target, reason (required for
  destructive actions), requestId, route, ipHash**. Reason must be a required field
  on ban/restore/delete/mark-compromised.
- **Case-gated content views are themselves audited** (`CONTENT_EVIDENCE_VIEWED`
  with the linking case id) — viewing private content is an auditable action.
- Auditor role can read but **never** writes (enforced by `RolesGuard`, verified by
  a guard test like the existing `roles.guard.test.ts`).

## 7. Database additions needed

1. `RoleKey` enum: add `support_agent`, `auditor` (+ Owner handling).
2. **`SupportTicket`** + **`SupportTicketMessage`** (thread, assignee, status, type,
   links to user/report/appeal).
3. **`Appeal`** (type, subjectUserId, relatedReportId/relatedContentId, status,
   decision, decidedBy/At, evidence refs) — covers appeals + ownership claims.
4. **`OtpDeliveryEvent`** (country, maskedPhone, provider, route, status, failureCode,
   latencyMs, retryCount, createdAt) — populated by the auth/Telnyx path; **no codes**.
5. **`ReleaseChannel`/`AppRelease`** (platform, version, channel, minSupported,
   notes, strictMediaFlag, backendVersion) — small registry/config.
6. `User`: `adminNotes` relation (**`AdminNote`** model) + optional `compromisedAt`,
   `deletionScheduledAt` (admin-initiated deletion lifecycle).
7. Optional `Report.reportType` enum for the 10 queues (else filter on existing fields).

## 8. API additions needed (all under `/v1/admin/*`, RBAC + audit)

- Aggregates: `GET /v1/admin/overview` (dashboard counters).
- Users: `POST users/:id/force-logout`, `POST users/:id/revoke-sessions`,
  `POST users/:id/deletion/(start|cancel)`, `POST users/:id/mark-compromised`,
  `POST users/:id/notes`, `GET users/:id/(sessions|devices|reports|tickets|appeals)`.
- Reports: `POST reports/:id/assign`, `GET reports/:id/evidence` (case-gated, audited),
  category filters.
- Tickets: full CRUD `GET/POST tickets`, `GET tickets/:id`, `POST tickets/:id/(reply|assign|close|escalate|link)`.
- Appeals: `GET/POST appeals`, `GET appeals/:id`, `POST appeals/:id/(approve|deny|restore|request-evidence|escalate|uphold)`.
- OTP: `GET otp/deliveries` (masked), `POST otp/incident`, `POST otp/resend` (rate-limited, no code exposure).
- Releases: `GET/POST releases`, `PATCH releases/min-supported`.
- Bridge: service-auth middleware on pale-api + console server client.

### Feature matrix

| Feature | Existing endpoint | Missing endpoint | Needed DB model | RBAC | Audit | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| Overview counters | — | `GET /v1/admin/overview` | — (reads) | Auditor+ | no | P1 |
| User search | `GET /v1/admin/users` | filters/pagination polish | — | Support+ | no | P1 |
| User detail | `GET /v1/admin/users/:id` | sessions/devices/links sub-resources | — | Support+ | no | P1 |
| Report queue | `GET /v1/admin/reports` | category tabs | (reportType?) | Moderator+ | no | P1 |
| Report detail | `GET /v1/admin/reports/:id` | case-gated evidence | — | Moderator+ | view-audit | P1/P2 |
| Report status/action | `PATCH .../status`, `POST .../action` | assign | — | Moderator+ | ✓ exists | P2 |
| Suspend/Ban/Restore | `POST users/:id/{suspend,ban,restore}` | — | — | T&S+/Mod* | ✓ exists | P2 |
| Force logout / revoke sessions | — | new | — (uses Session) | T&S+ | ✓ | P4 |
| Start/cancel deletion (admin) | self-serve only | new | User fields | Admin/T&S | ✓ | P4 |
| Mark compromised / admin notes | — | new | AdminNote, User field | T&S+ | ✓ | P4 |
| Tickets | — (Feedback only) | full API | SupportTicket(+Message) | Support+ | partial | P3 |
| Appeals & claims | — | full API | Appeal | T&S+ | ✓ | P3 |
| OTP delivery dashboard | reliability logs only | masked delivery API | OtpDeliveryEvent | Support+ | incident-only | P5 |
| Releases/version | appVersion on Device | registry API | AppRelease | Admin+ | ✓ | P6 |
| Audit log viewer | `GET /v1/admin/audit-logs` | filters/export | — | Auditor+ | n/a | P1 |
| Staff auth bridge | — | service-auth | (Session staff) | system | ✓ | **P0/P1** |

## 9. Safe implementation phases

- **Phase 0 (prereq):** staff auth bridge (console ↔ pale-api service credential) +
  add `support_agent`/`auditor` roles + console RBAC mapping. No user-facing mutations.
- **Phase 1:** read-only Overview + Users search/detail + Report queue + Audit-log
  viewer (consume existing `GET` endpoints; no mutations).
- **Phase 2:** Report review actions (assign/status/action) + case-gated evidence +
  audit (mostly existing endpoints; add evidence + assign).
- **Phase 3:** Support tickets + Appeals/claims (new models + APIs).
- **Phase 4:** Account control / session control (force-logout, revoke, deletion,
  mark-compromised, notes) — destructive, confirm + permission gated.
- **Phase 5:** OTP delivery dashboard (masked).
- **Phase 6:** Releases/version control.
- **Phase 7:** Advanced T&S automation.

## 10. First coding phase recommendation

**Start with Phase 0 + Phase 1, scoped to read-only.** Rationale:

- It is the **safest** (no mutations, no destructive actions, satisfies every hard
  rule by construction) and unblocks everything else.
- It delivers immediate value: real Users/Reports/Audit views on top of the
  **already-existing** `v1/admin` GET endpoints.
- The only new backend work is the **service-auth bridge** (P0) — small, isolated,
  and required regardless of later phases.
- It extends the `/console/pale` module already shipped, reusing the console shell,
  RBAC decorators, and the proven AnnouPale module patterns.

**Concrete first slice:** the staff service bridge + `/console/pale/users`,
`/console/pale/reports`, `/console/pale/audit-logs` as read-only lists wired to the
existing pale-api GET endpoints, with the console enforcing the Auditor/Support/
Moderator view gates. No write path ships until Phase 2 is reviewed.
