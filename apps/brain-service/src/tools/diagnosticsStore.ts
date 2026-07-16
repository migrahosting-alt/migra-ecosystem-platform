import type { DiagnosticsGetResponse } from '@migrapilot/protocol';

type StoredDiagnostic = DiagnosticsGetResponse['items'][number];
type RootDiagnosticsMap = Map<string, StoredDiagnostic[]>;

const diagnosticsByRoot: RootDiagnosticsMap = new Map();

export function setDiagnostics(rootPath: string, items: StoredDiagnostic[]): void {
  diagnosticsByRoot.set(rootPath, items);
}

export function getDiagnostics(rootPath: string, filePath?: string): StoredDiagnostic[] {
  const items = diagnosticsByRoot.get(rootPath) ?? [];

  if (!filePath) {
    return items;
  }

  return items.filter((item) => item.path === filePath);
}