# P6 Operational-Validation Evidence

**Purpose:** collect repeatable evidence for the §16 checklist in `pilot-api-integration-plan.md` before `auto` could be reconsidered as the shipping default. **This does NOT flip P6.** Default remains `local-brain` + provider `stub`.

**How to reproduce:** `npm run test:ops` (dedicated Extension-Host runner `runOps.ts` → only the ops matrix, isolated). Each scenario is driven through the real extension via the public API + deterministic mocks; the sanitized `backendDiagnostics()` snapshot and per-run fields are captured and written to `$MIGRAPILOT_EVIDENCE_DIR/ops-evidence-<ts>.json`. All matrix runs assert the **no-silent-fallback** invariant per scenario.

**Environment:** WSL2 (Linux) Extension Host, VS Code 1.114.0, both source (`dist`) and packaged (VSIX) extension identity. The packaged-VSIX-on-**non-WSL** row remains **NOT COLLECTED** here — it requires a supported non-WSL host and must be run there.

## Matrix — Run 1 (dev Extension Host, 11/11 scenarios pass)

| Scenario | mode | selected backend | decision reason | local probe | remote probe | changed | no silent fallback | user-facing status | recovery path | port 3988 after |
|---|---|---|---|---|---|---|---|---|---|---|
| clean-activation | local-brain | local | local-mode-configured | unknown | n/a | false | ✅ | MigraPilot: local | none | free / not owned |
| local-brain-unavailable | local-brain | local | local-mode-configured | down | n/a | false | ✅ | local (degraded) | configure brainAutoStartCommand / start brain, Repair | free / not owned |
| foreign-process-on-brain-port | local-brain | local | local-mode-configured | conflict | n/a | false | ✅ | local (degraded) | free the port / different brainUrl, Repair | **occupied / not owned** (foreign not adopted or killed) |
| invalid-or-missing-remote-token | remote-pilot | remote-unavailable | remote-not-ready | unknown | unauthorized | true | ✅ | pilot-api unavailable (unauthorized) | Set Token, then Repair | free / not owned |
| pilot-api-outage | remote-pilot | remote-unavailable | remote-error | unknown | unavailable | false | ✅ | pilot-api unavailable (unavailable) | Repair once reachable | free / not owned |
| provider-failure | local-brain | local | local-mode-configured | unknown | n/a | true | ✅ | MigraPilot: local | Retry / switch provider (commit-gen returned error, no fabricated message) | free / not owned |
| explicit-repair-recovery | remote-pilot | remote | remote-ready | unknown | ready | **true** | ✅ | MigraPilot: pilot-api | none (recovered on repair) | free / not owned |
| session-stability-no-change-without-repair | remote-pilot | remote | remote-ready | unknown | ready | false | ✅ | MigraPilot: pilot-api | none (2× non-forced resolve added 0 events) | free / not owned |
| auto-remote-ready | auto | remote | auto-remote-ready | unknown | ready | false | ✅ | MigraPilot: pilot-api | none | free / not owned |
| auto-remote-degraded-selects-local | auto | local | auto-remote-not-ready-local-selected | unknown | unauthorized | true | ✅ | MigraPilot: local | none (by-design auto→local; not a silent fallback) | free / not owned |
| auto-start-then-shutdown-port-state | local-brain | local | local-mode-configured | ready | n/a | false | ✅ | MigraPilot: local | none | **free / not owned after shutdown** |

### Invariants observed on every scenario
- **No silent fallback:** every explicit `remote-pilot` failure stayed `remote-unavailable` (never local). `auto→local` on a degraded remote is by design and is recorded with the remote probe outcome.
- **Selection stable without repair:** two non-forced resolves added **0** diagnostic events; the backend only changed on an explicit re-resolution (`changed=true` on invalid-token, provider-failure(mode change), explicit-repair, auto-degraded).
- **Foreign occupant:** detected as `conflict`, never adopted or killed (`owned=false`, port stayed occupied by the foreign process).
- **Process/port after shutdown:** the auto-started brain was shut down cleanly — port 3988 free, `ownedByExtension=false`.
- **Sanitization:** snapshots contain only enums / a protocol version / coarse boolean flags — no tokens, URLs, headers, or bodies (also asserted by the unit + host no-secret tests).

## Repeatability — confirmed (3 runs, 2026-07-15)
Three consecutive `npm run test:ops` runs each passed **11/11** scenarios. The normalized `[OPS]` decision lines (all fields except timestamps) are **byte-identical across run 1, run 2, and run 3** (`diff` clean). Each `test:ops` is a fresh Extension-Host activation — i.e. a real restart — so `clean-activation` resolving identically each time is direct restart-stability evidence. Raw per-run snapshots are retained at `$MIGRAPILOT_EVIDENCE_DIR/ops-evidence-<ts>.json` (defaults to a temp dir; the in-repo `docs/p6-evidence/` output path is gitignored so machine-specific evidence never lands in the tree).

> This is a deterministic, mock-backed matrix. It is necessary but **not sufficient** for P6: real-deployment repeatability (many restarts, real outages/recovery over time) and the non-WSL VSIX row still need collecting in their target environments.

## Proven here (mock, repeatable) vs. still required (real environment)

**Proven under the deterministic matrix:** decision logic, no-fallback behavior, session stability, repair/recovery behavior, ownership rules (foreign-occupant conflict → not adopted/killed), and cleanup semantics (port free + not owned after shutdown) — all 3× repeatable-identical.

**Still required before P6 can be reconsidered — collect in the target environments (owner decision):**
- [ ] Packaged-VSIX validation on a supported **non-WSL** host.
- [ ] Repeated runs against a **real pilot-api deployment**.
- [ ] Real **outage and recovery** behavior.
- [ ] Real **invalid-token and capability-incompatibility** behavior.
- [ ] **Restart stability** over multiple real sessions.
- [ ] **Provider-failure** behavior against a real configured provider.
- [ ] Confirmation that **diagnostics remain sanitized** in those environments.

Until every row above is collected, **P6 remains HELD**. Defaults stay: backend mode `local-brain`, provider deterministic `stub`. Re-run `npm run test:ops` in each target environment and append the resulting `[OPS]` lines / JSON here — this report + harness are the mechanism for completing the decision.
