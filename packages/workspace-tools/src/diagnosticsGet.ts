import { DiagnosticsGetRequestSchema, type DiagnosticsGetResponse } from '@migrapilot/protocol';
import type { DiagnosticsSource } from './adapters.js';

/** Read-only. Returns diagnostics from the host-injected source; touches no files. */
export function diagnosticsGet(input: unknown, opts: { diagnostics: DiagnosticsSource }): DiagnosticsGetResponse {
  const req = DiagnosticsGetRequestSchema.parse(input);
  return { tool: 'diagnostics.get', items: opts.diagnostics.get(req.rootPath, req.path) };
}
