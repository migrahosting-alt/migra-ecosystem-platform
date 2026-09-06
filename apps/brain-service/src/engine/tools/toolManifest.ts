/**
 * CANONICAL TOOL METADATA — the only source of "does this tool mutate anything?".
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY MUTABILITY IS NOT AN ARGUMENT
 *
 * The router's first shape took `mutating` on the request. That is a bypass with
 * a polite name: a caller who wants to skip the consent gate simply declares
 * `mutating: false`, and every gate after it agrees. The consent boundary would
 * then protect only callers who had already decided to be careful — which is not
 * a boundary.
 *
 * So mutability is a property of the TOOL, declared here, and the router looks it
 * up. A request cannot assert it, cannot override it, and cannot supply a tool id
 * that is not in this table: an unknown tool is refused rather than defaulted,
 * because defaulting an unknown tool to read-only is the same bypass reached by
 * a different road.
 * ---------------------------------------------------------------------------
 */

/** Whether the tool needs an account linked before it can act. */
export type ConnectionRequirement = 'none' | 'account';

export interface ToolManifestEntry {
  toolId: string;
  /** The product-facing capability name. Shown to users; never an internal id. */
  capability: string;
  /**
   * Does invoking this cause a side effect a user would want to approve?
   *
   * Canonical. Not overridable per invocation, at any layer.
   */
  mutating: boolean;
  connection: ConnectionRequirement;
  /** One line describing what it does, for the UI. */
  summary: string;
}

const ENTRIES: readonly ToolManifestEntry[] = [
  {
    /*
     * A mutating fixture, declared here rather than invented by a test — the
     * whole point of the table is that nothing outside it can assert mutability,
     * and that has to include the tests that check the rule.
     */
    toolId: 'test.mutating',
    capability: 'Test mutating action',
    mutating: true,
    connection: 'account',
    summary: 'Fixture used to exercise the consent path. Not exposed to users.',
  },
  {
    toolId: 'conversations.rename',
    capability: 'Rename conversation',
    mutating: true,
    connection: 'none',
    summary: 'Change the title of one of your conversations.',
  },
  {
    toolId: 'documents.search',
    capability: 'Document search',
    mutating: false,
    connection: 'none',
    summary: 'Search the documents you have uploaded and approved.',
  },
];

const BY_ID = new Map(ENTRIES.map((e) => [e.toolId, e]));

/** Every declared tool. The catalog is this table, not a scan of the codebase. */
export function allTools(): readonly ToolManifestEntry[] {
  return ENTRIES;
}

/**
 * Look up a tool. `undefined` for anything not declared here.
 *
 * Callers must refuse on `undefined` rather than construct a default. An unknown
 * tool with assumed-safe metadata is exactly the hole this table closes.
 */
export function toolManifest(toolId: string): ToolManifestEntry | undefined {
  return BY_ID.get(toolId);
}
