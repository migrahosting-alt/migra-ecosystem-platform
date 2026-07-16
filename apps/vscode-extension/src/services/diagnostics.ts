import * as vscode from 'vscode';
import type { DiagnosticItem } from '@migrapilot/shared-types';

export function toDiagnosticItems(uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[]): DiagnosticItem[] {
  return diagnostics.map((item) => ({
    file: uri.fsPath,
    code: normalizeDiagnosticCode(item.code),
    message: item.message,
    severity: diagnosticSeverityToString(item.severity),
    startLine: item.range.start.line + 1,
    endLine: item.range.end.line + 1,
  }));
}

export function diagnosticSeverityToString(
  severity: vscode.DiagnosticSeverity,
): 'error' | 'warning' | 'info' {
  if (severity === vscode.DiagnosticSeverity.Error) {
    return 'error';
  }
  if (severity === vscode.DiagnosticSeverity.Warning) {
    return 'warning';
  }
  return 'info';
}

function normalizeDiagnosticCode(code: vscode.Diagnostic['code']): string | undefined {
  if (typeof code === 'string') {
    return code;
  }
  if (typeof code === 'number') {
    return String(code);
  }
  if (code && typeof code === 'object') {
    return typeof code.value === 'number' ? String(code.value) : code.value;
  }
  return undefined;
}