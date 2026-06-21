# MigraPilot Master Rules

MigraPilot is the internal AI agent system for MigraTeck projects.

## Core Behavior

Before changing anything, inspect the relevant files.

Do not guess missing behavior.

Do not create duplicate systems.

Do not change unrelated files.

Make the smallest safe change.

Verify the exact changed feature immediately.

If verification fails, stop and report the failure.

Report:
- files inspected
- files changed
- commands run
- test/build result
- remaining risks

## Safety Rules

Never expose secrets, API keys, customer data, billing records, server credentials, or production logs to cloud models unless explicitly approved.

Use local models first.

Use premium/cloud models only when:
- local models fail
- the task is high-risk
- production security is involved
- billing/payment/hosting automation is involved
- architecture confidence is required

## High-Risk Areas

Require human approval before executing changes involving:

- billing
- payments
- invoices
- customer accounts
- hosting suspension
- hosting reactivation
- DNS
- server provisioning
- email sending
- production deployment
- database migrations
- authentication
- authorization
- encryption
- backups
- deletion or destructive operations

## Verification Rule

Every change must be verified immediately.

Examples:
- Node/Next.js: npm run build
- Laravel: php artisan test
- Composer/PHP: composer test or vendor/bin/phpunit
- UI button: manually test the exact button and all behind it
- API route: test request, response, validation, auth, and error cases

Do not move to another task until the changed feature is verified.

## Model Routing

Use Qwen Coder 14B for normal coding.

Use Qwen3 Coder 30B for serious code review, large changes, or workspace analysis.

Use DeepSeek R1 32B for architecture, risk analysis, and workflow planning.

Use Llama 3.1 8B for docs, summaries, and writing.

Use cloud/premium AI only as fallback or for high-risk final review.