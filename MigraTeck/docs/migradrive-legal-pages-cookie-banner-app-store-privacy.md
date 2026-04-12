# MigraDrive Legal Pages, Cookie Banner, and Store Privacy Baseline

Last updated: April 11, 2026

## 1) What is live on the web today

- Public legal routes exist in the MigraTeck app for `/privacy` and `/terms`.
- Shared legal metadata and contact details are centralized through `src/lib/legal.ts` and `src/lib/migradrive-public-config.ts`.
- The cookie banner is mounted globally and now supports a real preferences center, not just accept or reject buttons.
- Consent persistence is versioned and timestamped in `src/lib/privacy/cookie-consent.ts`.
- The site footer includes a `Cookie Preferences` entry point so users can reopen the preferences center after first dismissal.
- Optional marketing analytics in the public access request flow are disabled until analytics consent is granted.

## 2) Web consent implementation status

Current behavior is stronger than the earlier draft baseline.

- Essential storage is always on for authentication continuity, consent persistence, and required session behavior.
- Optional categories are split into `preferences` and `analytics`.
- Consent records include `state`, `preferences`, `source`, `version`, and `updatedAt`.
- Legacy consent keys are migrated forward into the current storage key.
- The UI supports `Accept all cookies`, `Reject optional cookies`, and `Save preferences`.
- The banner listens for an explicit open event so other UI surfaces can reopen it without duplicating logic.
- The current marketing analytics emitters short-circuit unless `canUseOptionalAnalytics()` returns true.

## 3) Public config and legal data model

Public-facing brand and legal values are no longer scattered as hardcoded literals.

- Brand name, operator name, website URL, support email, legal email, privacy email, address lines, legal last-updated value, consent version, and consent storage key now come from the centralized public config module.
- The environment schema and `.env.example` were extended to support these public values cleanly.
- This means legal copy, consent behavior, and public contact information can now be changed without hunting through multiple components.

## 4) Mobile app audit summary

The Flutter mobile app under `migradrive/apps/migradrive_app` materially affects store disclosures.

- `AuthService` now persists endpoint, access key, secret key, display name, email, auth method, and logged-in state in platform-secure storage via `flutter_secure_storage`.
- Legacy auth keys are migrated out of `SharedPreferences` into secure storage at app startup and then removed from prefs.
- The app declares Android background sync and notification capabilities, including foreground service, boot handling, wake lock, and notifications.
- The iOS app declares background fetch and processing tasks.
- The app exposes a sync diagnostics screen that can copy diagnostics and export a support bundle to the clipboard.
- Clipboard-based diagnostics exports are now sanitized before export, with opaque identifiers pseudonymized and secret-like fields scrubbed.
- The sync telemetry collector is currently an in-memory ring buffer with a future remote sink, not a confirmed production crash or analytics SDK.
- The settings flow contains an in-app upgrade path that requests a checkout URL from `https://migrapanel.com/api/storage/checkout` and opens it in a web view. The UI also states that payments are processed by Stripe.
- The app exposes file, photo, sync, trash, and versioning surfaces, so user content handling is part of the shipped product scope.

## 5) Mobile local data and retention audit

This is the stricter audit outcome for on-device data, using current code rather than placeholder UX or dependency lists.

- Auth session material is stored in platform-secure storage, not in plaintext prefs.
- The local Drift schemas include files, versions, audit logs, device sessions, retention policies, share links, operations, upload parts, sync cursors, offline pins, activity logs, feed cursor states, pending mutations, diagnostic upload sessions, and sync conflicts.
- Repository code shows some of that local state can include user IDs, org IDs, session IDs, resource IDs, device info, IP addresses, metadata JSON, token hashes, and password hashes when persisted.
- The queued mutation database still stores a dedicated `localPath` column for file mutations, but the payload JSON has now been minimized to only the metadata still needed at runtime, such as MIME type.
- Applied file mutations now scrub their retained `localPath` and payload JSON fields after successful upload instead of leaving that local metadata behind in the queue row, and completed queue rows are purged after a short retention window.
- File and photo flows can write downloaded bytes to app temp storage, app documents storage, and on Android to `/storage/emulated/0/Download`.
- Trash, versioning, and offline file state are materially present, so user content may exist locally beyond transient screen rendering.
- Support exports are safer than before because clipboard output is sanitized, and sync error strings now redact filesystem paths instead of echoing raw local paths into diagnostics-oriented state.

## 6) Persistence truthing

The most important mobile disclosure nuance is that schema capability is broader than confirmed persistent storage in the current app bootstrap.

- `appDatabaseProvider` currently defaults to `AppDatabase(NativeDatabase.memory())`.
- `syncDriftDatabaseProvider` currently defaults to `MigraDriveSyncDriftDatabase(NativeDatabase.memory())`.
- A separate production-grade sync composition root exists and can open a file-backed SQLite database named `migradrive_sync.sqlite` in the application documents directory.
- The current `main.dart` bootstrap does not invoke that production override bundle. It wires the sync engine directly from the default providers.
- The current queue hardening reduces what would be left behind if persistent Drift storage is enabled later: redundant JSON copies of local file path and file name were removed, successful mutations scrub their queue-local path and payload fields, completed rows are purged after a short retention window, and the upload scheduler no longer stores raw upload session IDs in diagnostic reason text.
- Because of that, the strict current statement is: the app has code paths and repositories for rich local persistence, but the audited entrypoint does not yet prove those Drift datasets are file-backed in the current runtime.
- User-directed file downloads are different from database persistence. Those save flows are definitely file-backed today and must be disclosed as local device storage behavior.

## 7) Important disclosure boundaries

These distinctions matter when answering Apple and Google forms.

- A package appearing in `pubspec.yaml` is not, by itself, enough to claim collection or sharing. Release behavior matters.
- Local-only diagnostics and clipboard export are not the same as automated remote crash or analytics collection.
- Sanitized clipboard export reduces support-bundle leakage, but it does not remove the need to govern underlying local operational data.
- Placeholder login methods should not be declared as active collection channels unless the release build enables them.
- The Stripe-backed upgrade flow is materially present and should be treated as a live purchase path if the screen ships.
- Current code supports significant local operational data handling even where the audited bootstrap still appears memory-backed.

## 8) App Store privacy form matrix

Use the table below as the strict current MigraDrive baseline for Apple submission, subject to final release verification.

| Apple data type / question | Current answer | Linked to user | Used for tracking | Basis for answer |
| --- | --- | --- | --- | --- |
| Does the app collect data? | Yes | Yes | No | The app operates authenticated storage, sync, file, and billing flows tied to an account or tenant. |
| Contact info | Yes, email and display name if the shipping auth path uses them | Yes | No | Email and display name are stored in the auth session snapshot and used for account operation. Do not declare phone number unless phone auth ships. |
| Identifiers | Yes | Yes | No | Authenticated flows, session state, tenant-linked activity, file ownership, and repository-backed IDs all tie activity to a user context. |
| User content | Yes | Yes | No | Files, photos, versions, trash, and downloaded content are core functionality. Some content can also be written to device-visible storage. |
| Purchases | Yes, if the in-app upgrade screen ships | Yes | No | Settings can request a checkout URL and open a Stripe-backed purchase flow. |
| Usage data | Yes, conservative answer | Yes | No | Sync operations, activity logs, operational events, and product interaction are part of app functionality, even where some local stores may currently be memory-backed. |
| Diagnostics | No for remote diagnostics based on the audited code | No | No | Local diagnostics and support exports exist, but no confirmed production crash or remote diagnostics sink was found in the audited code. |
| Is data used for tracking? | No | n/a | No | No ad SDK, no cross-app tracking SDK, and no confirmed tracking code were found. |

Purpose mapping for Apple is currently best answered as follows.

- Contact info: app functionality, account management, security.
- Identifiers: app functionality, account management, security.
- User content: app functionality.
- Purchases: app functionality, billing.
- Usage data: app functionality, product operations.
- Diagnostics: do not declare unless the release build actually transmits diagnostics off device.

## 9) Google Play data safety matrix

Use this as the strict Google Play baseline unless release behavior changes.

| Google Play category | Current answer | Shared | Required | Basis for answer |
| --- | --- | --- | --- | --- |
| Personal info | Yes for email and display name when used by the active auth flow | No, except processors required to operate the service | Yes | Account access and authenticated product operation use these fields. |
| App activity | Yes | No | Yes | Sync actions, activity logs, queue state, and operational usage are part of product functionality. |
| Files and docs / photos and videos | Yes | No, except service processors required to deliver storage features | Yes | User content upload, download, preview, save, trash, and version features are core product behavior. |
| App info and performance | No for automated remote diagnostics based on the audited code | No | No | Local diagnostics tooling exists, but no confirmed remote diagnostics SDK or sink was found. |
| Financial info | Yes, if the in-app Stripe checkout path ships | Yes to the payment processor as part of the transaction flow | Optional feature, not needed for base auth | The app opens a Stripe-backed checkout web flow from settings. |
| Device or other IDs | Yes, conservative answer | No | Yes | Session IDs, user-linked resource IDs, and operational identifiers are used in authenticated service flows. |
| Data collected | Yes | n/a | n/a | The service processes account-linked content and operational state. |
| Data shared | No for advertising or broker-style sharing | n/a | n/a | Only declare sharing where a payment processor or essential service operator receives data to complete the user-requested flow. |
| Encrypted in transit | Yes | n/a | n/a | Network flows are expected to use HTTPS and the checkout path is HTTPS-based. |
| Deletion requests supported | Yes | n/a | n/a | This should align with account, support, and backend deletion workflows in the final policy text. |
| Tracking | No | n/a | n/a | No advertising, cross-app profiling, or marketing SDK tracking was confirmed. |

## 10) Release gates before filing store forms

- Verify the live public pages and mailboxes used in the policies are operational.
- Confirm whether the release build includes the in-app Stripe checkout path or falls back to external web only.
- Confirm whether any remote telemetry sink was added after this audit.
- Re-check which authentication modes are actually enabled in the release build.
- Confirm the release build still uses platform-secure storage for auth session material on both iOS and Android.
- Decide whether the production release should keep the current in-memory Drift bootstrap or switch to the file-backed sync bootstrap intentionally.
- If file-backed Drift persistence is enabled later, re-open the disclosure review because local retention posture becomes materially stronger.

## 11) GDPR notes

The previous draft is outdated. The current web implementation already satisfies several items that were previously described as future work.

- Consent versioning already exists on the web.
- Consent records already include a timestamp and explicit preference categories.
- Users can reopen and change cookie preferences after the initial banner interaction.
- Optional analytics in the audited public marketing flow are already consent-gated.
- Public privacy and terms routes already exist and should be treated as live documentation, not planned work.
- The mobile app's auth persistence is now materially stronger than the earlier audit state. Session material is stored through platform-secure storage with migration out of legacy prefs-backed keys.
- The remaining GDPR-sensitive mobile work is not auth secret storage anymore. It is retention-window governance for local operational records, user-directed file-save behavior, and whether richer file-backed SQLite persistence is intentionally enabled in the release artifact.
- If backend systems log authenticated API activity, account identifiers, or support events, those server-side facts must be reconciled with the final privacy notice before store submission.

## 12) Immediate implementation order

The old implementation order is stale. The web privacy foundation is already live, so the next priority sequence should be:

1. Freeze the release truth table for mobile auth modes, checkout, notifications, media access, telemetry, and device-storage save flows.
2. Decide intentionally whether mobile Drift state should remain memory-backed at bootstrap or move to the file-backed production executor.
3. Reconcile store-form answers against the exact release build, not against placeholder UI or dependency lists.
4. Re-verify that the privacy policy text matches both the web consent model and the mobile release behavior.
5. Add time-based purge rules for applied or stale local operational records if persistent Drift storage is enabled.
6. Run a final legal and security review before App Store and Google Play submission.

## 13) Final note

The web side is now materially ahead of the original draft: legal routes are live, consent is versioned and category-based, optional analytics are gated, and public legal values are centralized.

The remaining risk is mobile disclosure accuracy and intentionality around local persistence. Auth session storage is already correctly hardened into platform-secure storage; the next decisive step is to lock the mobile release artifact, verify whether richer local state is intentionally persistent, and file Apple and Google disclosures from that exact runtime truth.
