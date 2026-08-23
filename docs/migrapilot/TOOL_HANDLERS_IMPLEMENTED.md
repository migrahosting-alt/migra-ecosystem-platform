# Tool Handlers Implemented

## READ
- `system.health` -> `GET /health` on mpanel-core base API.
- `tenants.list` -> `PROVIDER_UNAVAILABLE` (authority not unified yet).
- `tenants.get` -> `PROVIDER_UNAVAILABLE`.
- `pods.list` -> `GET /api/client/cloudpods`.
- `pods.get` -> `PROVIDER_UNAVAILABLE`.
- `domains.list` -> `GET /api/domains`.
- `dns.lookup` -> `GET /api/dns/zones/:zone`.
- `logs.search` -> `GET /api/system-events` (client-side filtering note).

## WRITE
- `pods.create` -> `PROVIDER_UNAVAILABLE` (stable create API missing).
- `domains.provision` -> `POST /api/domains/register` or `/api/domains/transfer`.
- `dns.createRecord` -> `PUT /api/dns/zones/:zone/records`.
- `mail.createMailbox` -> `POST /api/email/mailboxes`.
- `wordpress.deploy` -> `PROVIDER_UNAVAILABLE` (provider handler TODO).

## DANGER
- `pods.delete` -> `PROVIDER_UNAVAILABLE`.
- `dns.deleteRecord` -> `DELETE /api/dns/zones/:zone/records`.
- `storage.deleteObject` -> `PROVIDER_UNAVAILABLE`.
- `storage.purgeBucket` -> `PROVIDER_UNAVAILABLE`.

All handlers still return the standard `tool_result` envelope and preserve stable contracts.
