# API Routes Added

## pilot-api
- `GET /health`
- `POST /api/pilot/chat/stream` (SSE)
- `GET /api/pilot/conversations?search=`
- `POST /api/pilot/conversations`
- `GET /api/pilot/conversations/:id`
- `POST /api/approvals/request`
- `POST /api/approvals/:id/approve`
- `POST /api/approvals/:id/deny`

## SSE events
- `conversation` (conversationId)
- `token` (assistant text chunks)
- `tool` (tool status updates)
- `error`
- `done`
