# MigraPilot Production Diagnostics — Target Registry

© MigraTeck LLC. Internal operational document.

The target registry is **server-authoritative**. Clients select a registered
`targetId` and an approved `endpointId` only — never a host, port, URL, SSH
destination, connection string, file path, or command. This is what stops the
diagnostics provider from becoming SSRF, port-scan, arbitrary-log, or command-
execution infrastructure.

## Target fields

| Field | Meaning |
|---|---|
| `targetId` | Stable identifier the client references |
| `tenantId` | Owning tenant (environment/tenant binding) |
| `environment` | `production` \| `staging` (must be in the provider allowlist) |
| `serviceType` | `http-service` \| `container` \| `database` \| `dns-zone` \| `tls-endpoint` \| `mail` \| `storage` |
| `displayName` | Human label |
| `approvedEndpoints[]` | `{ id, host, port?, url?, expectedRecords? }` — host/url live HERE, never in a request |
| `approvedCapabilities[]` | The `production.diagnostics.*` checks this target permits |
| `credentialRef` | Name of a diagnostics-specific, read-only credential (never a value; see credential doc) |
| `timeoutMs` | Per-request ceiling (provider `maxTimeoutMs` still caps it) |
| `rateLimitPerMinute` | Requests/min against this target |
| `redactionProfile` | `standard` \| `strict` |
| `enabled` | A disabled target is indistinguishable from unknown (`TARGET_NOT_ALLOWED`) |

## Onboarding a target

1. Confirm the target is a legitimate owned service and the check is genuinely
   read-only for it.
2. Add the target to the operator-config JSON referenced by
   `MIGRAPILOT_PROD_DIAGNOSTICS_TARGETS_FILE` (an array, or `{ "targets": [...] }`).
3. List only the endpoints and capabilities that are approved — least privilege.
4. Reference a read-only `credentialRef` (or omit for pure network checks).
5. Set a conservative `timeoutMs` and `rateLimitPerMinute`.
6. Restart the brain. Verify via `GET /api/ai/production-diagnostics/targets`
   (returns safe summaries — no credential, no raw host/url).

## Safe-summary guarantee

`GET /targets` returns `targetId`, `tenantId`, `environment`, `serviceType`,
`displayName`, `approvedCapabilities`, `endpointIds`, `enabled` — and **never** a
`credentialRef` or a raw endpoint host/url.

## Prohibited

- Never accept a client-supplied host/port/url/path/command/SQL — the provider
  rejects unknown params (`ARBITRARY_INPUT_REJECTED`).
- Never add a target "just to unblock" a run. Unregistered = fail closed.
- A malformed/unreadable targets file yields an **empty** registry (fail closed),
  never a startup crash and never a permissive default.
