# MigraDrive Production Storage Validation Plan

## Scope

Validate production object storage behavior after beta hardening and before public launch.

## 1. Signed URL Validation

### Upload

Command pattern:

```bash
curl -X PUT "$SIGNED_URL" --data-binary @file.txt
```

Validate:

- Upload succeeds.
- Object lands in the correct tenant path.
- Metadata matches content type and object key expectations.

### Download

Command pattern:

```bash
curl "$SIGNED_URL" -o file.txt
```

Validate:

- Download returns the correct file.
- No cross-tenant access is possible.

### Expiry

- Wait until the signed URL passes its TTL.
- Retry the same request.

Expected result:

- `403` or storage-provider equivalent access denial.

## 2. Tenant Isolation

Attempt to use a signed URL issued for tenant A from tenant B context.

Expected result:

- Access fails.
- No object content is returned.

## 3. Multipart Upload

Validate the full sequence:

- initiate multipart upload
- upload all parts
- finalize upload

Validate:

- Object assembles correctly.
- Final size matches the source payload.
- Tenant quota and usage update correctly.

## 4. Quota Enforcement

Test sequence:

- Fill a tenant close to quota.
- Attempt another upload that exceeds quota.

Expected result:

- API rejects the upload with quota error.
- No orphaned object or phantom pending state remains.

## 5. Race Conditions

Run at least 10 concurrent uploads against the same tenant.

Validate:

- No quota bypass.
- No duplicate finalize.
- No negative or inconsistent storage counters.

## 6. Delete and Restore Policy

If restore is part of the launch scope, validate:

- delete moves object to the expected state
- restore returns it to active state
- quota policy matches the product decision

If restore is not in scope, document that delete is final for beta.

## 7. Failure Recovery

Simulate:

- upload transfer interrupted mid-stream
- finalize request failure

Validate:

- No orphaned quota consumption.
- No corrupt active rows.
- Cleanup policy reclaims abandoned pending uploads.

## 8. Evidence to Capture

- Request and response payloads for init, upload, finalize, download, delete, and share.
- Object keys and tenant IDs used in validation.
- Storage-provider logs for denied requests and expired URLs.
- Application logs and metrics for cleanup triggers and file actions.
- Screenshots or Playwright traces for user-visible failures.

## 9. Exit Criteria

Production storage is considered validated only when:

- Signed upload and download behave correctly.
- Expiry works reliably.
- Cross-tenant access is blocked.
- Quota enforcement cannot be bypassed.
- Concurrent operations do not corrupt state.
- Failure recovery leaves tenant state consistent.