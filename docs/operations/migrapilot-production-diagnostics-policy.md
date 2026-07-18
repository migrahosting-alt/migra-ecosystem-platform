# MigraPilot Production Diagnostics — Policy

© MigraTeck LLC. Internal operational document.

## Purpose

Allow MigraPilot to inspect production health and produce evidence-based
diagnostics **without any production mutation capability**. This is a dedicated,
read-only provider, separate from the local workspace engineer, the capability
registry, `fs.applyChangeset`, production delegation, and `command.run`.

**This slice does not enable production delegation or any live production
mutation.** A tool is not read-only merely because its name contains `diagnose`,
`check`, or `inspect`.

## Supported checks (read-only)

`production.diagnostics.*`: `serviceHealth`, `logs` (bounded window + line cap,
redacted), `metrics`, `database` (connectivity + safe metadata only), `dns`,
`tls`, `http` (approved URL only), `mail` (sends no email), `storage` (no
writes), `summary` (rollup of the target's approved checks).

## Prohibited actions (never available through diagnostics)

restart · reload · deploy · rollback · scale · kill · write file · edit config ·
change DNS · renew/replace certificates · modify DB data or schema · run
migrations · flush queues · replay jobs · send production email · create users ·
rotate credentials · change firewall/ports · push code · invoke any mutating
production tool. There is **no generic production shell** (`command.run` /
`terminal.exec` are not exposed here).

## Access model (all gates fail closed)

Disabled by default. A request must pass, in order: provider enabled →
authenticated operator (separate token space) → registered read-only capability →
no arbitrary client input → registered + enabled target → approved environment →
capability approved for that target → approved endpoint → rate limit. Then it runs
under a timeout + output caps, and the result is redacted before transport,
logging, telemetry, and audit. Local coding-agent availability does **not** grant
production diagnostics access.

## Result contract

`status` (healthy | degraded | unhealthy | unknown | unreachable | unauthorized),
`observations`, `evidence` (bounded, redacted), `interpretation`, `limitations`,
`recommendedNextSteps`. Never `healthy` merely because a connection opened.
Recommendations are **advisory text only** — nothing consumes them as an
instruction; a diagnostic can never trigger remediation.

## Failure codes

`PROVIDER_DISABLED` · `UNAUTHORIZED` · `TARGET_NOT_ALLOWED` ·
`ENVIRONMENT_NOT_ALLOWED` · `CAPABILITY_NOT_ALLOWED_FOR_TARGET` ·
`READ_ONLY_CAPABILITY` (mutation/unknown capability) · `ARBITRARY_INPUT_REJECTED`
(client-supplied host/url/port/command/sql/path) · `RATE_LIMITED` · `TIMEOUT`.

## Audit expectations

Every attempt is correlated and durably audited:
`production.diagnostics.{requested,completed,failed,denied}` with safe metadata
only (target id, capability, environment, status/code) — never credentials,
hosts, or evidence bodies.

## Emergency disable

Set `MIGRAPILOT_PROD_DIAGNOSTICS_ENABLED=false` (or unset it) and restart the
brain. With no enablement the provider fails closed on every request. Removing all
operator tokens (`MIGRAPILOT_PROD_DIAGNOSTICS_OPERATOR_TOKENS`) also blocks all
runs (`UNAUTHORIZED`).

## Stop conditions

- Any sign a diagnostic is being asked to change state → refuse; it cannot.
- Credential value observed in output → treat as an incident (see incident-response doc).
- Unregistered target requested → `TARGET_NOT_ALLOWED`; never add ad-hoc targets to unblock.

## Escalation

Suspected boundary weakness (a mutation reachable, a secret in output, an
arbitrary target accepted) → disable the provider and escalate to the owner before
further use. Production delegation remains a separate governance program.
