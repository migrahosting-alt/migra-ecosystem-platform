# Candidate gates

Two harnesses that drive a **running Brain** through its real HTTP API. Nothing
here is in-process: a pass means the data came back from PostgreSQL, not from a
cache that happens to still be warm.

Both are split into a pre-restart and a post-restart phase. The restart is the
point — it is the only thing that can tell "the database recorded it" apart from
"the process remembers it", which is exactly the distinction three shipped
defects turned on.

```bash
node gates/candidate-gate.mjs write        # seed every domain under scope A
node gates/approved-index-gate.mjs phase1  # create → sync → approve → retrieve → delete
sudo systemctl restart <the brain service>
node gates/candidate-gate.mjs read         # everything survived, isolation intact
node gates/approved-index-gate.mjs phase2  # still approved, still deleted
```

Point them at another instance with `BASE` at the top of each file.

## Health is a precondition, not an observation

Both harnesses `exit 2` unless `/health` reports `persistence: ready`,
`migrationState: current`, no detail, and schema ≥ 11.

An earlier run reported 7/7 while persistence was `unavailable`. Migration 11 had
failed, so every "durable" write lived only in the in-memory index built during
sync. Every functional assertion was true and the result was worthless. Leaving
that check to whoever reads the output is what let the false pass stand.

## Every "it is gone" assertion carries a control

"The deleted conversation is still gone after a restart" passes perfectly if
persistence is dead and *everything* is gone. So each deletion test creates a
sibling it does not delete, and asserts the survivor came back — with its
content — **before** asserting the absence of the other.

The workspace control lives in a different scope, because `openWorkspace` is
deliberately one-workspace-per-scope: a second POST in the same scope reopens the
existing record rather than creating a sibling. That shape is better anyway — it
also proves the delete did not reach across scopes.

## What these caught

- An index approved through the real API came back `experimental` with no
  approved version after a restart: `setIndexState` and `setApprovedVersion` ran
  their UPDATE with no scope declared, matched zero rows under FORCE row-level
  security, and reported success.
- `DELETE /api/ai/conversations/:id` with `content-type: application/json` and no
  body answered `500 Internal server error` — Fastify rejects an empty JSON body
  before the route runs.
- The deployment boot test created a SQLite database in the staging tree and
  shipped it into two PostgreSQL release directories.
