# MigraPilot Usage Ledger

© MigraTeck LLC. Internal operational document.

## Purpose

An append-only, **metadata-only** record of every provider execution — for cost
attribution and local-vs-cloud accounting. It is never a content store.

## Record fields

`usageId`, `executionCorrelationId`, `providerId`, `modelId`, `executionMode`
(engineer/chat/escalation), `policy`, `localOrCloud`, `timestamp`, `outcome`,
`escalationReason?`, `consentOrOfferId?`, `reservationId?`, `inputTokens?`,
`outputTokens?`, `costUsd?`, `costStatus` (actual/estimated/unknown), and for cloud:
`providerReportedCostUsd?`, `calculatedCostUsd?`, `costDiscrepancyUsd?`,
`billingRequestId?`; for local: `equivalentCloudCostUsd?`, `estimatedSavingsUsd?`,
`localCostStatus` (estimated/unknown).

## Never stored

Prompts, completions, source code, tool output, diffs, API keys, approval tokens,
cloud consent tokens, raw workspace paths. Forbidden keys are hard-dropped on
append and every string is run through the canonical redactor.

## Estimated vs actual

Cloud usage uses provider-reported tokens where available (`costStatus: actual`);
otherwise a bounded estimate (`estimated`) — never claimed as provider-confirmed.
Provider-reported cost is stored alongside the calculated cost so a discrepancy is
observable, never trusted blindly.

## Local accounting + savings

Local execution is tracked separately. It does **not** claim local is literally
`$0`: `costStatus` is `unknown` for the local marginal cost, and the avoided cloud
spend is reported as a clearly-labeled ESTIMATE (`estimatedSavingsUsd`,
`localCostStatus: estimated`). When no cloud price reference exists, savings are
`unknown` — never a confident `$0`.

## Queries (read-only API)

`GET /api/ai/providers/usage` — bounded, paginated; filter by provider / model /
local-or-cloud / time. `GET /api/ai/providers/usage/:correlationId` — one
execution. `GET /api/ai/providers/budget` — scope status + reservation totals.
`POST /api/ai/providers/budget/estimate` — a labeled `estimated` preflight. No
mutation, no client limit increase, no secrets, no prompts/responses.
