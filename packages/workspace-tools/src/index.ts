// @migrapilot/workspace-tools — runtime-neutral, hardened workspace tool contracts
// shared by the brain (local runtime) and pilot-api (delegated runtime), so both
// execute the SAME canonical tool IDs, schemas, and logic. Hosts inject a bounded
// filesystem + diagnostics source; the tools enforce path containment, dry-run,
// read-back, and all-or-nothing writes. Schemas are the canonical ones from
// @migrapilot/protocol.

export * from './adapters.js';
export * from './errors.js';
export * from './paths.js';
export * from './metadata.js';
export * from './editApply.js';
export * from './diagnosticsGet.js';
export * from './nodeFs.js';

// Re-export the canonical schemas so consumers have one import surface.
export {
  EditApplyRequestSchema,
  EditPreviewChangeSchema,
  DiagnosticsGetRequestSchema,
  type EditApplyRequest,
  type EditApplyResponse,
  type EditPreviewResponse,
  type DiagnosticsGetRequest,
  type DiagnosticsGetResponse,
} from '@migrapilot/protocol';
