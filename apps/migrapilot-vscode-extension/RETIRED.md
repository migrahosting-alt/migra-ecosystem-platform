# RETIRED — do not extend

This extension (`migrateck.migrapilot-vscode-extension`, v0.4.2) is a superseded
MigraPilot VS Code line (28 commands). It was uninstalled from the dev host on
2026-07-10.

**Canonical MigraPilot VS Code surface is now `apps/vscode-extension`**
(`migrateck.migrapilot-extension`), registered in the monorepo workspace and wired
to `apps/brain-service`. Do not add features here.

## Why retired
Decision (2026-07-10): consolidate on the existing pilot-web + brain-service +
apps/vscode-extension stack. Multiple parallel VS Code extensions (`vscode-extension`,
`migrapilot-vscode`, `migrapilot-vscode-extension`) collided on the `migrapilot.*`
command/view namespace.

## Status
Kept in-tree for reference (`.vsix` packages retained). Not the active surface.
Before deleting, harvest any command handlers worth porting into the canonical
extension.
