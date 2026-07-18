# MigraPilot Production Diagnostics — Credential Model

© MigraTeck LLC. Internal operational document.

Diagnostics use **diagnostics-specific, least-privilege, read-only** credentials.
A target references a credential by NAME (`credentialRef`); the value is resolved
server-side and **never** enters a result, a run record, a log, telemetry, or the
audit chain.

## Required credential types (examples)

- read-only API tokens;
- log-reader roles;
- metrics-reader roles;
- database accounts restricted to safe reads + metadata (no DML/DDL/locks, no
  sensitive row access);
- SSH principals that cannot use a shell or mutation commands, where SSH is
  required;
- scoped DNS/certificate inspection APIs **without** write permission.

## Never reuse

- root credentials;
- deployment credentials;
- broad cloud administrator tokens;
- production database owners;
- any credential capable of changing infrastructure.

## Operator authentication is separate

Operator access to the diagnostics API uses a **distinct bearer-token space**
(`MIGRAPILOT_PROD_DIAGNOSTICS_OPERATOR_TOKENS`, `principal=token` pairs) that maps
a token to an authenticated principal in the operator allowlist. A workspace
`ToolApprovalStore` approval token can **never** authorize a production diagnostic
— the two token spaces do not overlap. Local coding-agent availability grants no
production access.

## Non-leakage guarantees

- Results, run records, and `/targets` responses are asserted to contain no
  `credentialRef` value (threat test coverage).
- Every result string is run through the canonical redactor (secrets + paths)
  before transport and persistence.
- Audit fields are metadata only, denylisted + redacted; no credential, host, or
  evidence body is ever persisted.

## Rotation

Rotate diagnostics credentials on the normal read-only-credential schedule.
Rotation is an operator action performed **outside** MigraPilot — diagnostics can
never rotate a credential.
