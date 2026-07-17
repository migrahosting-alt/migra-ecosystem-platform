# MigraPilot Redaction Policy

© MigraTeck LLC. Internal operational document.

## Purpose

Sensitive data must never leak through any coding-agent output, telemetry,
audit record, incident, or operator endpoint. This policy defines what each
surface may expose and the single canonical layer that enforces it.

## Canonical layer

All redaction flows through `apps/brain-service/src/engine/redaction.ts`
(`redactValue`, `redactString`, `sanitizeError`, `redactCommandOutput`). It is
recursive, cycle-safe, depth/node/length bounded, and deterministic, and uses
**both** key-based and value-pattern detection — field names alone are not
trusted. Markers: `[REDACTED_SECRET]`, `[REDACTED_TOKEN]`,
`[REDACTED_CREDENTIAL]`, `[REDACTED_PATH]`, `[TRUNCATED]`. Partial secrets are
never emitted (no "first/last four characters").

## Sensitive-data classes (redacted everywhere)

Access/bearer/API tokens, OAuth secrets, passwords, DB connection strings,
PEM/private-key material, cloud credentials (e.g. AWS access keys),
authorization/cookie headers, sensitive environment values, URLs with embedded
credentials or secret query params, email/payment/hosting/infra credentials,
engine approval tokens, proposal bodies where only metadata is allowed, raw
workspace paths in metadata surfaces, and any value matched by the canonical
patterns.

## Boundary policy

| Surface | May expose | Must never expose |
|---|---|---|
| Proposal / diff (operator review) | approved workspace-relative paths, source content for review | credentials, approval tokens, env secrets, unrelated files, raw absolute host paths |
| Telemetry / audit / incidents / health | metadata only | file contents, patches, diffs, command output, raw paths, approval tokens, env values |
| Command / validation output | operator-visible output **after** redaction + truncation | raw secrets; raw output copied into metadata-only stores |

## Failure paths

Error handling must not bypass redaction. `sanitizeError` normalizes any thrown
value (Error, `cause` chains, Zod issues, arbitrary objects) with **no stack
trace** on the wire. The SSE failure path and the HTTP error handler use the
same policy. Raw development detail is opt-in via `MIGRAPILOT_DEBUG_ERRORS=true`
only — `NODE_ENV` does not gate secret exposure.

## Command handling

`command.run` redacts stdout/stderr **before** returning, enforces output caps,
and reports a `redacted` flag. Timeout and spawn errors use the same redaction
path. Raw output is never written into fallback audit logs.

## Prohibited shortcuts

- Do not add a surface that serializes raw errors, headers, or env.
- Do not weaken the denylist or patterns to "make a log readable".
- Do not print secrets to work around a redaction — fix the boundary.

## Verification

`npm test -w @migra/brain-service` (see `test/redaction.test.ts` — adversarial
fixtures for every class). Live acceptance: run a command that prints fixture
credentials and confirm every external surface is sanitized.
