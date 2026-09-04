// Agent definitions are the shared source of truth for BOTH runtimes (the local
// brain runtime and the delegated pilot-api runtime), so a delegated run plans +
// executes the exact same agent the engine would run locally. They live in the
// `@migrapilot/agent-defs` package; this module re-exports them so existing brain
// imports (`./agentRegistry.js`) stay stable.
export * from '@migrapilot/agent-defs';
