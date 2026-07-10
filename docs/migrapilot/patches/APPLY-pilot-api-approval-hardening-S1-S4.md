# Apply: pilot-api approval hardening (S1–S4)

Verified change to `services/pilot-api` addressing 4 security findings from
[../PILOT_API_CAPABILITY_MAP.md](../PILOT_API_CAPABILITY_MAP.md). Produced in a
checkout where `services/pilot-api` is **not tracked** (source of truth is on-host),
so it is handed off as a patch rather than committed here.

## What it changes (5 files)
- `src/services/approvalService.ts` — **S1** pure `assertApprovable()` (PENDING + not-expired + approver≠requester) and atomic `approveApprovalRequest()`/`denyApprovalRequest()` (CAS via `updateMany`); **S2** `resolveSigningSecret()` fails closed in production if `APPROVAL_SIGNING_SECRET` is unset.
- `src/routes/approvals.ts` — routes now call the hardened service helpers; both `/:id/approve` and the compat `/:id` endpoint are covered; typed error → HTTP status mapping.
- `src/routes/admin.ts` — **S3** `adminRouter.use(requireAuthOrDev)` (was unauthenticated: breaker force-flip + usage stats).
- `src/routes/tickets.ts` — **S4** `ticketsRouter.use(requireAuthOrDev)` (was unauthenticated: change-ticket approve/apply/rollback).
- `src/services/approvalService.test.ts` — **new**, 13 vitest cases.

## Apply (on the host / repo where pilot-api is tracked)
From the directory that contains `services/pilot-api/`:

```bash
git apply --check docs/.../pilot-api-approval-hardening-S1-S4.patch   # dry run
git apply        docs/.../pilot-api-approval-hardening-S1-S4.patch
# or, if the tree has drifted: patch -p1 < ...patch   (tolerates fuzz)
```

## Verify after applying
```bash
cd services/pilot-api
npx tsc -p tsconfig.json --noEmit          # expect: clean
npx vitest run src/services/approvalService.test.ts   # expect: 13 passed
npx vitest run                             # expect: full suite green (was 53)
```
Locally this patch passed all three (tsc clean, 13 new tests, 53/53 total).

## ⚠ Deploy prerequisite (S2 is fail-closed)
After this patch, **production must set `APPROVAL_SIGNING_SECRET`**. If it is unset in
prod, approval-token minting/verification will throw by design (previously it silently
used the public default `"dev-approval-secret-change-me"`). Set the env var before or
with deploy, or approvals will break. Non-prod keeps the dev fallback.

Optional: `PILOT_ALLOW_SELF_APPROVAL=true` re-enables self-approval where a single
operator legitimately both requests and approves (off by default in prod).

## Provenance
Baseline reconstructed from the pre-edit files in this checkout; patch validated to
reproduce the current working-tree files byte-for-byte before handoff. If the on-host
tree differs, review the 4 modified-file hunks (the new test file applies cleanly
regardless).
