// @migrapilot/pilot-client — the shared, vscode-free client for the pilot-api
// backend. Transport, protocol contracts, correlation, authentication, SSE
// streaming, cancellation, retry/reconciliation, capability negotiation, and
// typed errors — one networking implementation consumed by both the MigraAI
// Engine (brain-service) and the VS Code extension. No UI or vscode dependency.

export * from './correlation.js';
export * from './pilotErrors.js';
export * from './capabilities.js';
export * from './actionState.js';
export * from './contracts.js';
export * from './pilotApiClient.js';
export * from './approvalsClient.js';
export * from './agentRun.js';
