# Demo Script: Dry-run -> Approval -> Execute

## Prereqs
- Pilot API running at `http://localhost:3377`
- Valid Migra JWT in `$TOKEN`
- Existing conversation ID in `$CONV` (or create one)

## 1) Create conversation
```bash
curl -s -X POST http://localhost:3377/api/pilot/conversations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

## 2) Dry-run pod create via chat (no approval required)
```bash
curl -N -X POST http://localhost:3377/api/pilot/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId":"'$CONV'",
    "message":"Run tool pods.create for tenant abcdefgh with domain demo-client.com and plan cp-business using idempotency key idem-001",
    "dryRun": true
  }'
```
Expected: `tool` events ending in completed/failed contract response, no approval required.

## 3) Request non-dry-run (approval required)
```bash
curl -N -X POST http://localhost:3377/api/pilot/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId":"'$CONV'",
    "message":"Run tool dns.createRecord for tenant abcdefgh zone clientdomain.com name www type CNAME value app.clientdomain.com with idempotency key idem-002 and dryRun false",
    "dryRun": false
  }'
```
Expected: tool error code `APPROVAL_REQUIRED` with `approvalRequest` payload.

## 4) Approve request
```bash
curl -s -X POST http://localhost:3377/api/approvals/<approvalId>/approve \
  -H "Authorization: Bearer $TOKEN" | jq .
```
Save `approvalToken` from response.

## 5) Execute with approval token
```bash
curl -N -X POST http://localhost:3377/api/pilot/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId":"'$CONV'",
    "message":"/tool dns.createRecord {"correlationId":"11111111-1111-1111-1111-111111111111","tenantId":"abcdefgh","zone":"clientdomain.com","record":{"name":"www","type":"CNAME","values":["app.clientdomain.com"]},"dryRun":false,"approvalToken":"<approvalToken>","idempotencyKey":"idem-002"}",
    "dryRun": false
  }'
```

## 6) Verify replayability
```bash
curl -s http://localhost:3377/api/pilot/conversations/$CONV \
  -H "Authorization: Bearer $TOKEN" | jq .
```
Check messages, runs, tool calls, and tool results timeline.
