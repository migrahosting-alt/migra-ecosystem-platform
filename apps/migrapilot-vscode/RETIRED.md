# RETIRED — do not extend

This extension (`migrateck.migrapilot-vscode`, v0.0.4) was a hand-rolled prototype
that reimplemented context capture, a readiness-queued webview, and draft-diff
generation without a backend.

**Canonical MigraPilot VS Code surface is now `apps/vscode-extension`**
(`migrateck.migrapilot-extension`), which is registered in the monorepo workspace
and is wired to `apps/brain-service`. Do not add features here.

## Why retired
Decision (2026-07-10): consolidate on the existing pilot-web + brain-service +
apps/vscode-extension stack. This line was a fourth competing VS Code surface and
was never wired to the real engine.

## Salvageable ideas (only if a webview is later added to the canonical extension)
- Capture editor + selection **before** focusing the webview (focus clears
  `activeTextEditor`). See `src/commands.ts`.
- Webview **readiness handshake + message queue** so first-load messages are not
  dropped. See `src/webviewProvider.ts` (`webviewReady`, `pendingMessages`).

## Status
Kept in-tree for reference. Not built, not packaged, not installed. Uncommitted
Phase 4 working-tree changes here are prototype-only.
