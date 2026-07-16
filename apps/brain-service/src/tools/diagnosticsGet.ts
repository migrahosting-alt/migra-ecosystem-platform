import { type DiagnosticsGetRequest, type DiagnosticsGetResponse } from '@migrapilot/protocol';
import { diagnosticsGet as sharedDiagnosticsGet } from '@migrapilot/workspace-tools';
import { getDiagnostics } from './diagnosticsStore.js';

// The brain's diagnostics come from the in-memory editor-sync store; the shared
// read-only tool contract is the same one pilot-api implements with its own source.
export async function diagnosticsGet(input: DiagnosticsGetRequest): Promise<DiagnosticsGetResponse> {
  return sharedDiagnosticsGet(input, { diagnostics: { get: (rootPath, p) => getDiagnostics(rootPath, p) } });
}
