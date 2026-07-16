# Gap #2 — Non-Production Agent Delegation Validated

**Milestone:** `MIGRAPILOT_NONPROD_AGENT_DELEGATION_VALIDATED` — **MET** (local non-production, Option C)
**Date:** 2026-07-16 · **Delegation flag:** OFF by default · **Production:** untouched, not deployed

## Deliverable in this commit

Two `runtime: 'pilot'` **delegated variants** added to the shared agent registry
(`@migrapilot/agent-defs`): `workspace.diagnostics.pilot` and
`workspace.fix-diagnostics.pilot`. They carry the SAME canonical contract + plan as
their local twins but route through the delegated runtime. They are **opt-in**: with
delegation disabled they fail closed, and the existing local agents are unchanged.

## Validated chain (real, end to end)

```
brain /api/ai/agents/runs (runtime:'pilot')
  → @migrapilot/pilot-client (AgentRunClient, shared)
  → pilot-api /api/pilot/v1/agent-runs (gate ON, non-prod)
  → AgentRunService + realAgentRunDeps (SHARED agent-defs plan)
  → workspaceToolExecutor (SHARED @migrapilot/workspace-tools; server-controlled root)
  → PrismaAgentRunStore → PostgreSQL
```

Executed locally against a throwaway PostgreSQL container, a real pilot-api server,
a real brain instance, and a temporary workspace. Nothing in the tool chain was
simulated (the shared `workspaceToolExecutor` + `editApply`/`diagnosticsGet` ran for
real; pilot-api's diagnostics *source* is empty — a data source, not a fake tool).

## Evidence demonstrated

- **Run-state** (brain): `CREATED>PLANNING>RUNNING>COMPLETED` for the read-only agent;
  `…>WAITING_FOR_APPROVAL>APPROVED>RESUMING>COMPLETED` for the mutating agent — a
  single `PLANNING` (**no re-plan after approval**).
- **Direct PostgreSQL**: runs persisted in `execution_runs` (`mode=dry-run`, actor
  server-side); `pilot_pending_actions` `PENDING→EXECUTED` with args + approval
  material held server-side; `execution_events` audit written.
- **Server-controlled root**: a client `rootPath` was overridden by the server root —
  the client could not select it.
- **Containment fail-closed**: a `../../etc/passwd` path parked, then on approve →
  `FAILED PATH_ESCAPE`; the system file was untouched.
- **Idempotency**: same key → same pilot run, one DB row.
- **Forced dry-run**: the mutating agent never mutated the workspace, before or after
  approval; the exact proposed action was persisted server-side.
- **No leak**: the brain run view exposed no approvalId, args, rootPath, or
  replacement material.
- **Approval binding**: approval bound to the exact stored action by runId.

## Gates (all green at commit time)

packages build (protocol, agent-defs, pilot-client, workspace-tools) · brain 125 ·
pilot-api 431 · extension unit 174 / integration 51 / vsix 51.

## Explicitly NOT done (future promotion work, not blockers)

- Production deployment validation + authorization for any live mutating action.
- A real server-side diagnostics provider (linter or provided diagnostics).
- Brain-level concurrency + restart-persistence revalidation (proven earlier against
  the same real Postgres in the prior Option-C run).

Production delegation is a separate authorization decision and remains disabled
everywhere. The mutating agent stays dry-run-only until a separate prod sign-off.
