/**
 * MigraAI Engine — version contract.
 *
 * A precise compatibility surface so clients (VS Code, MigraPanel, web, mobile,
 * CLI) can reason about what an engine supports, and so migrations/debugging are
 * unambiguous. Each sub-version is bumped ONLY on a breaking change to that
 * subsystem's contract — not on every code change.
 */

/** Semantic version of the engine build. */
export const ENGINE_VERSION = '1.0.0-alpha.1';

/** `/api/ai/*` request/response contract version. Bump on a breaking wire change. */
export const PROTOCOL_VERSION = 1;

/** Capability Registry (tools + agents) contract version. */
export const REGISTRY_VERSION = 1;

/** Semantic RAG (index/chunk/retrieve) contract version. */
export const RAG_VERSION = 1;

/** Conversation/workspace memory contract version. */
export const MEMORY_VERSION = 1;

/** Model qualification (states + manifest) contract version. */
export const QUALIFICATION_VERSION = 1;

export interface EngineVersion {
  engineVersion: string;
  protocolVersion: number;
  registryVersion: number;
  ragVersion: number;
  memoryVersion: number;
  qualificationVersion: number;
  /** Durable-store schema version (0 when persistence is unavailable). */
  schemaVersion: number;
}

export function engineVersion(schemaVersion: number): EngineVersion {
  return {
    engineVersion: ENGINE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    registryVersion: REGISTRY_VERSION,
    ragVersion: RAG_VERSION,
    memoryVersion: MEMORY_VERSION,
    qualificationVersion: QUALIFICATION_VERSION,
    schemaVersion,
  };
}
