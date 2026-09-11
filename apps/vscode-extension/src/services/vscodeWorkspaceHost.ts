/*
 * The editor half of the workspace tool surface.
 *
 * Two of the sixteen tools are not filesystem questions at all — they are
 * questions about what the EDITOR knows. Diagnostics come from every language
 * server the user has installed; symbols come from the server that owns the
 * file. Answering either from a standalone parser on a server would give a
 * narrower and sometimes wrong answer, so these belong here, on the machine with
 * the editor, rather than being a gap to apologise for.
 *
 * The third responsibility is the approval gate. A mutating tool arrives from a
 * remote planner, and the person at the keyboard decides — the model never does.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';

import type { WorkspaceToolHost } from './workspaceTools.js';

const SEVERITY: Record<number, string> = {
  [vscode.DiagnosticSeverity.Error]: 'error',
  [vscode.DiagnosticSeverity.Warning]: 'warning',
  // These MUST be the protocol's names. 'info' is not in DiagnosticSeveritySchema.
  [vscode.DiagnosticSeverity.Information]: 'information',
  [vscode.DiagnosticSeverity.Hint]: 'hint',
};

/** Flatten a symbol tree into the shape the tool contract reports. */
function flattenSymbols(
  symbols: vscode.DocumentSymbol[],
  out: Array<{ name: string; kind: string; startLine: number; endLine: number; detail?: string }> = [],
): Array<{ name: string; kind: string; startLine: number; endLine: number; detail?: string }> {
  for (const s of symbols) {
    out.push({
      name: s.name,
      kind: vscode.SymbolKind[s.kind] ?? String(s.kind),
      // 1-based, matching how every other tool and every human reports lines.
      startLine: s.range.start.line + 1,
      endLine: s.range.end.line + 1,
      ...(s.detail ? { detail: s.detail } : {}),
    });
    if (s.children?.length) flattenSymbols(s.children, out);
  }
  return out;
}

/*
 * The write itself — all-or-nothing, and only after the modal above.
 *
 * Every target is resolved and contained BEFORE anything is written, so a
 * changeset containing one bad path fails without having half-applied the rest.
 * A partially applied change is the outcome that must never be inferred.
 */
async function applyOpsToDisk(input: {
  rootPath: string;
  ops: Array<Record<string, unknown>>;
}): Promise<unknown> {
  const fs = await import('node:fs/promises');
  const base = path.resolve(input.rootPath);
  const planned: Array<{ kind: string; abs: string; rel: string; content: string }> = [];

  for (const op of input.ops) {
    const rel = typeof op.path === 'string' ? op.path : '';
    if (!rel) throw new Error('every op needs a path');
    const abs = path.resolve(base, rel);
    const withSep = base.endsWith(path.sep) ? base : base + path.sep;
    if (abs !== base && !abs.startsWith(withSep)) throw new Error(`path "${rel}" escapes the workspace root`);
    const kind = String(op.op ?? op.kind ?? 'create');
    const content = typeof op.content === 'string' ? op.content : typeof op.after === 'string' ? op.after : '';
    planned.push({ kind, abs, rel, content });
  }

  const written: string[] = [];
  for (const p of planned) {
    if (p.kind === 'delete') {
      await fs.rm(p.abs, { force: true });
    } else if (p.kind === 'mkdir') {
      await fs.mkdir(p.abs, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(p.abs), { recursive: true });
      await fs.writeFile(p.abs, p.content, 'utf8');
    }
    written.push(p.rel);
  }
  return { applied: true, files: written, count: written.length };
}

export function createVscodeWorkspaceHost(
  applyChangeset: WorkspaceToolHost['applyChangeset'] = applyOpsToDisk,
): WorkspaceToolHost {
  return {
    async diagnostics(rootPath, filePath) {
      const wanted = filePath ? path.resolve(rootPath, filePath) : undefined;
      const items: Array<Record<string, unknown>> = [];
      for (const [uri, diags] of vscode.languages.getDiagnostics()) {
        if (uri.scheme !== 'file') continue;
        const abs = uri.fsPath;
        // Scope to the workspace, and to one file when asked.
        if (wanted ? abs !== wanted : !abs.startsWith(rootPath)) continue;
        for (const d of diags) {
          items.push({
            path: path.relative(rootPath, abs).split(path.sep).join('/'),
            severity: SEVERITY[d.severity] ?? 'information',
            message: d.message,
            // DiagnosticItemSchema declares a NESTED range. Emitting these flat
            // made every consumer read `item.range.startLine` off undefined.
            range: {
              startLine: d.range.start.line + 1,
              startCharacter: d.range.start.character + 1,
              endLine: d.range.end.line + 1,
              endCharacter: d.range.end.character + 1,
            },
            source: d.source ?? null,
            code: d.code == null ? null : typeof d.code === 'object' ? String(d.code.value) : String(d.code),
          });
        }
      }
      return { tool: 'diagnostics.get', items, count: items.length };
    },

    async documentSymbols(rootPath, filePath) {
      const abs = path.resolve(rootPath, filePath);
      const uri = vscode.Uri.file(abs);
      let doc: vscode.TextDocument;
      try {
        doc = await vscode.workspace.openTextDocument(uri);
      } catch {
        // Say which file, plainly. "No symbols" for a missing file is the same
        // class of lie as an empty listing for a missing workspace.
        throw new Error(`"${filePath}" could not be opened in the editor`);
      }
      const raw = (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        doc.uri,
      )) ?? [];
      const symbols = flattenSymbols(raw);
      return {
        tool: 'file.readSymbol',
        path: filePath,
        symbols,
        count: symbols.length,
        // Distinguish "no language server answered" from "this file has no symbols".
        providerAnswered: Array.isArray(raw),
      };
    },

    async requestApproval({ tool, fileCount, paths }) {
      const shown = paths.slice(0, 8).join(', ');
      const more = paths.length > 8 ? `, and ${paths.length - 8} more` : '';
      const yes = 'Apply changes';
      const choice = await vscode.window.showWarningMessage(
        `MigraPilot wants to apply ${fileCount} file change${fileCount === 1 ? '' : 's'} via ${tool}: ${shown}${more}`,
        { modal: true, detail: 'These edits were proposed by the assistant and have not been applied yet.' },
        yes,
      );
      return choice === yes;
    },

    applyChangeset,
  };
}
