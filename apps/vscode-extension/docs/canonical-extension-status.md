# Canonical MigraPilot VS Code Extension — Status & Classification

**Decision date:** 2026-07-15 · **Owner-ratified** · Supersedes the conflicting claim in `apps/migrapilot-vscode/README.md`.

## Canonical designation

**`apps/vscode-extension` is the canonical MigraPilot VS Code extension.**

| Field | Value |
|---|---|
| Path | `apps/vscode-extension` |
| Extension id | `migrateck.migrapilot-extension` |
| `name` | `migrapilot-extension` |
| `displayName` | `MigraPilot` |
| Entry | `./dist/extension.js` |
| Workspace member | ✅ root `package.json` `workspaces` |
| Build/dev/package | `build:extension`, `dev:extension` → `-w migrapilot-extension`; `npm run package` (vsce) in-dir |
| Test gates | `test:integration` (dev host, 8), `test:vsix` (packaged, 7+1 pending) |
| Milestone | `MIGRAPILOT_VSCODE_EXTENSION_E2E_AND_VSIX_READY` (2026-07-15) |

This is the extension all release/build/package tooling targets and the only VS Code extension in the monorepo workspace.

## Classification of the other VS Code extension lines

| Path | id / displayName | Version | **Classification** | Canonical claim allowed? |
|---|---|---|---|---|
| `apps/vscode-extension` | `migrateck.migrapilot-extension` / **MigraPilot** | 0.1.0 | **CANONICAL** | ✅ |
| `apps/migrapilot-vscode` | `migrateck.migrapilot-vscode` / MigraPilot Chat | 0.18.0 | **PRIOR-ART / REFERENCE** (webview chat cockpit + working pilot-api SSE transport). Retained read-only for reference until explicitly retired, migrated, or renamed. | ❌ |
| `apps/migrapilot-vscode-extension` | `migrateck.migrapilot-vscode-extension` / MigraPilot | 0.4.2 | **RETIRED** (2026-07-10; see its `RETIRED.md`). Uninstalled from dev host. | ❌ |

**Reference value of `apps/migrapilot-vscode`:** it already implements the pilot-api transport this program is adopting — SSE chat against `POST /api/pilot/chat/stream`, backend switch (`pilot-api`/`pilot-web`), `Bearer` token via `migrapilot.apiToken`, and an explicit *no-silent-fallback* stance. Its `src/pilotClient.ts` is the primary reference for P1.

## P0 ambiguity inventory (canonical-claim locations)

Every place the canonical designation is asserted or contradicted, with resolution status:

| # | Location | Prior state | Resolution |
|---|---|---|---|
| 1 | `apps/migrapilot-vscode/README.md:1,3,4` | Titled "(canonical)"; body: "the active, canonical … supersedes `apps/vscode-extension`" | **Reclassified** → prior-art/reference banner pointing to `apps/vscode-extension`. |
| 2 | `apps/migrapilot-vscode/package.json` `displayName` = "MigraPilot Chat" | distinct from canonical "MigraPilot" | **Acceptable** — distinct name; not a canonical claim. Left as-is. |
| 3 | `apps/migrapilot-vscode/package.json` description "canonical pilot-api" | refers to the **backend**, not the extension | **Acceptable** — pilot-api is the canonical backend. Left as-is. |
| 4 | `apps/migrapilot-vscode-extension/package.json` `displayName` = "MigraPilot" | **collides** with canonical displayName | **Disambiguated** → "MigraPilot (retired)" to remove marketplace/display collision. |
| 5 | `apps/migrapilot-vscode-extension/RETIRED.md` | Already names `apps/vscode-extension` canonical | **Consistent** — no change. |
| 6 | Root `package.json` workspaces / `build:extension` / `dev:extension` | Already target `migrapilot-extension` only | **Consistent** — no change. Evidence for exit-criterion 3. |
| 7 | `apps/vscode-extension/docs/pilot-api-integration-plan.md` §0.1 | Assumed-pending decision | **Locked** → decision recorded; §0.1 updated. |

**Scope note:** this inventory covers the three VS Code extension lines under `apps/`. No release/deploy shell scripts or CI workflows reference an extension directory directly (verified by grep); the monorepo release scripts (`scripts/release.js`, `release-check.js`) target the pilot-api `docs/migrapilot/phase-36` release train, not extension packaging.

## Follow-ups (not blocking P0)

- **Retire/migrate/rename `apps/migrapilot-vscode`.** As long as it stays in-tree, harvest reference value (pilot-api SSE client) into the canonical extension during P1, then schedule retirement or an explicit rename that drops any "MigraPilot" marketplace-display ambiguity. Tracked as a program follow-up, owner-scheduled.
- **Command/view namespace collision.** All three lines register `migrapilot.*` commands/views. Only the canonical extension may ship to a user; the others must not be installed alongside it (already true on the dev host).
