# Runbook — Proposal / Approval Store & Guard Recovery

© MigraTeck LLC. Internal operational document.

Operational procedures for the proposal store, approval store, audit sink, and
the local safety guard. Health for the stores + audit + incidents is available
at `GET /api/ai/engineer/stores/health`.

## Prerequisites

- Local access to `GET /api/ai/engineer/stores/health`.

## Capacity exhaustion (proposal or approval store)

1. Check `stores/health` → `utilization_percent`, `status`. `degraded` at ≥ 80%.
2. Capacity eviction is deterministic (expired-first, then oldest active) and
   **reported** — see `evictions` (`ttl_total` vs `capacity_total`).
3. If capacity pressure is chronic, stale proposals are likely un-applied. No
   action damages an active proposal; re-propose if a needed proposal was
   evicted (`UNKNOWN_PROPOSAL` on apply).

## Cleanup failure / unhealthy store

1. `stores/health` status `unhealthy` = cleanup failure or capacity invariant
   violated. Investigate the process; a restart re-initializes in-memory stores.
2. In-memory stores do not survive restart — expected; re-propose as needed.

## Unexpected eviction

1. `evictions.capacity_total > 0` with active proposals evicted → capacity
   pressure. Increase headroom or reduce proposal churn.

## Expired proposal / approval

- Proposal TTL 30 min; approval TTL 5 min (approval always expires first, so an
  approval can never outlive its proposal). On expiry, re-propose and re-approve.

## Missing authoritative proposal

- Apply returns `UNKNOWN_PROPOSAL` → the proposal is gone (unknown, expired, or
  already applied). Re-propose; never resubmit a changeset body.

## Audit sink degradation

- `stores/health.audit.status` `unhealthy` + `write_failures > 0` = durable
  audit writer failing. **Critical** audit events fail closed before a mutation.
  Investigate the durable sink before further applies.

## Missing local guard (Slice 1 fail-closed bootstrap)

The PreToolUse guard and settings are ignore-by-default local files that can
vanish on checkout/clone/worktree/env reset.

1. After any environment change: `npm run guards:verify`. Treat failure as
   guard **ABSENT** — do not run mutating git commands.
2. Reinstall from the version-controlled canonical source:
   `npm run guards:install` (copy → checksum → registration check → allow/deny
   policy matrix; fails closed on any incomplete state).
3. CI runs `npm run guards:test` on every PR.

## Prohibited shortcuts

- Do not disable the guard to "unblock" a push.
- Do not resubmit a changeset body to work around a missing proposal.
- Do not silence an unhealthy audit sink and continue mutating.
