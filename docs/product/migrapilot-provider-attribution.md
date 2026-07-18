# MigraPilot — Provider Attribution

© MigraTeck LLC.

Every completed response identifies how it was handled — truthfully. A response is
never labeled "local" merely because local execution started first.

## States

- **Handled locally · <provider> · <model>** — local success.
- **Cloud fallback used · <provider> · <model>** — with the escalation reason, the
  approved cost ceiling, and the actual/estimated cost.
- **Local result returned — cloud fallback recommended but not approved** — a
  qualifying local failure that was not escalated.

## Also shown

Selected provider + model, effective policy (and `requested → effective` when the
server downgraded it), escalation reason, and whether cost is **actual**,
**calculated**, **estimated**, or **unknown**. Unknown local cost is never shown as
`$0.00`.

## Not shown

Approval tokens, cloud request bodies, prompts, credentials, raw absolute paths, or
internal proposal bodies. Correlation ids are shortened.
