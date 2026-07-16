/**
 * MigraAI Engine — Capability Registry.
 *
 * The single, extensible catalog of everything the engine can execute on a
 * client's behalf. Today it holds TOOLS (file / git / workspace / diagnostics /
 * edit); the same registry is designed to later hold agents, deployment actions,
 * memory/embedding providers, and workflows — one registry instead of five.
 *
 * Clients never learn a capability's implementation: `list()`/`get()` expose only
 * sanitized METADATA (id, category, read-only/mutating, approval + dry-run flags,
 * schema versions, availability). The zod input schema and the handler stay in an
 * internal table reachable only through {@link runnable}.
 *
 * Availability is the ENGINE's decision: a capability is available only when every
 * one of its `requiredCapabilities` is in the granted set. A future
 * `terminal.exec` ships registered-but-unavailable until its grant is enabled.
 */

import type { ZodType } from 'zod';
import {
  WorkspaceSearchRequestSchema,
  FileReadRangeRequestSchema,
  FileReadSymbolRequestSchema,
  GitStatusRequestSchema,
  GitDiffRequestSchema,
  EditPreviewRequestSchema,
  EditApplyRequestSchema,
  DiagnosticsGetRequestSchema,
  CommandRunRequestSchema,
} from '@migrapilot/protocol';
import { commandRun } from '../tools/commandRun.js';
import { workspaceSearch } from '../tools/workspaceSearch.js';
import { fileReadRange } from '../tools/fileReadRange.js';
import { fileReadSymbol } from '../tools/fileReadSymbol.js';
import { gitStatus } from '../tools/gitStatus.js';
import { gitDiff } from '../tools/gitDiff.js';
import { editPreview } from '../tools/editPreview.js';
import { editApply } from '../tools/editApply.js';
import { diagnosticsGet } from '../tools/diagnosticsGet.js';

export type CapabilityKind = 'tool' | 'agent' | 'model' | 'deployment' | 'workflow';
export type CapabilityCategory =
  | 'file'
  | 'git'
  | 'workspace'
  | 'diagnostics'
  | 'edit'
  | 'terminal'
  | 'deployment';

/** Client-facing capability metadata — safe to serialize; no implementation. */
export interface CapabilityDescriptor {
  kind: CapabilityKind;
  id: string;
  displayName: string;
  description: string;
  category: CapabilityCategory;
  /** Grant tokens this capability needs; the engine decides if they're held. */
  requiredCapabilities: string[];
  readOnly: boolean;
  approvalRequired: boolean;
  supportsDryRun: boolean;
  supportsStreaming: boolean;
  inputSchemaVersion: number;
  outputSchemaVersion: number;
  /** Engine's decision: is this capability executable right now? */
  available: boolean;
}

type Handler = (input: unknown) => Promise<unknown>;

interface RunnableCapability {
  descriptor: Omit<CapabilityDescriptor, 'available'>;
  inputSchema: ZodType;
  handler: Handler;
  /** For mutating capabilities that support dry-run: how to produce a preview. */
  preview?: Handler;
}

/** Grants held by the local engine deployment. The read/write/git grants make the
 * eight brain tools available; `terminal.exec` / `deployment.*` are intentionally
 * NOT granted, so those future capabilities register as unavailable. */
export const LOCAL_GRANTS: ReadonlySet<string> = new Set(['workspace.read', 'workspace.write', 'git.read', 'command.run']);

const TOOLS: RunnableCapability[] = [
  {
    descriptor: meta('workspace.search', 'Workspace Search', 'Search workspace files for a query.', 'workspace', ['workspace.read'], { readOnly: true }),
    inputSchema: WorkspaceSearchRequestSchema,
    handler: (i) => workspaceSearch(i as never),
  },
  {
    descriptor: meta('file.readRange', 'Read File Range', 'Read a line range from a workspace file.', 'file', ['workspace.read'], { readOnly: true }),
    inputSchema: FileReadRangeRequestSchema,
    handler: (i) => fileReadRange(i as never),
  },
  {
    descriptor: meta('file.readSymbol', 'Read Symbol', 'Read the source of a named symbol.', 'file', ['workspace.read'], { readOnly: true }),
    inputSchema: FileReadSymbolRequestSchema,
    handler: (i) => fileReadSymbol(i as never),
  },
  {
    descriptor: meta('git.status', 'Git Status', 'Inspect the working tree status.', 'git', ['git.read'], { readOnly: true }),
    inputSchema: GitStatusRequestSchema,
    handler: (i) => gitStatus(i as never),
  },
  {
    descriptor: meta('git.diff', 'Git Diff', 'Inspect staged/unstaged diffs.', 'git', ['git.read'], { readOnly: true }),
    inputSchema: GitDiffRequestSchema,
    handler: (i) => gitDiff(i as never),
  },
  {
    descriptor: meta('diagnostics.get', 'Get Diagnostics', 'Read synced editor diagnostics.', 'diagnostics', ['workspace.read'], { readOnly: true }),
    inputSchema: DiagnosticsGetRequestSchema,
    handler: (i) => diagnosticsGet(i as never),
  },
  {
    descriptor: meta('edit.preview', 'Preview Edit', 'Compute a patch preview without writing.', 'edit', ['workspace.read'], { readOnly: true, supportsDryRun: true }),
    inputSchema: EditPreviewRequestSchema,
    handler: (i) => editPreview(i as never),
  },
  {
    // The one mutating capability: requires approval + supports dry-run (preview).
    descriptor: meta('edit.apply', 'Apply Edit', 'Apply a patch to workspace files.', 'edit', ['workspace.write'], {
      readOnly: false,
      approvalRequired: true,
      supportsDryRun: true,
    }),
    inputSchema: EditApplyRequestSchema,
    handler: (i) => editApply(i as never),
    // Dry-run / approval preview shares the edit.preview implementation (same input).
    preview: (i) => editPreview(i as never),
  },
  {
    // Policy-allowlisted argv execution (build/test/debug). NOT free shell —
    // argv[0] must be on the server allowlist, cwd is contained, no shell is
    // spawned. Distinct from terminal.exec (below), which stays ungranted.
    descriptor: meta('command.run', 'Run Command', 'Run an allowlisted build/test command in the workspace.', 'terminal', ['command.run'], {
      readOnly: false,
      approvalRequired: false,
    }),
    inputSchema: CommandRunRequestSchema,
    handler: (i) => commandRun(i as never),
  },
  {
    // Future capability — registered but UNAVAILABLE (grant not held), so it
    // appears in a full catalog listing yet is denied at dispatch. Proves the
    // engine (not the client) owns availability.
    descriptor: {
      kind: 'tool',
      id: 'terminal.exec',
      displayName: 'Run Terminal Command',
      description: 'Execute a shell command (not yet enabled).',
      category: 'terminal',
      requiredCapabilities: ['terminal.exec'],
      readOnly: false,
      approvalRequired: true,
      supportsDryRun: false,
      supportsStreaming: true,
      inputSchemaVersion: 1,
      outputSchemaVersion: 1,
    },
    inputSchema: EditApplyRequestSchema, // placeholder; unavailable so never dispatched
    handler: async () => {
      throw new Error('terminal.exec is not enabled');
    },
  },
];

function meta(
  id: string,
  displayName: string,
  description: string,
  category: CapabilityCategory,
  requiredCapabilities: string[],
  opts: { readOnly?: boolean; approvalRequired?: boolean; supportsDryRun?: boolean; supportsStreaming?: boolean } = {},
): Omit<CapabilityDescriptor, 'available'> {
  return {
    kind: 'tool',
    id,
    displayName,
    description,
    category,
    requiredCapabilities,
    readOnly: opts.readOnly ?? false,
    approvalRequired: opts.approvalRequired ?? false,
    supportsDryRun: opts.supportsDryRun ?? false,
    supportsStreaming: opts.supportsStreaming ?? false,
    inputSchemaVersion: 1,
    outputSchemaVersion: 1,
  };
}

export interface CapabilityFilter {
  category?: string;
  readOnly?: boolean;
  kind?: CapabilityKind;
  /** Include capabilities the engine currently can't execute. Default false. */
  includeUnavailable?: boolean;
}

export class CapabilityRegistry {
  private readonly byId = new Map<string, RunnableCapability>();

  constructor(private readonly grants: ReadonlySet<string> = LOCAL_GRANTS) {
    for (const cap of TOOLS) this.byId.set(cap.descriptor.id, cap);
  }

  private available(cap: RunnableCapability): boolean {
    return cap.descriptor.requiredCapabilities.every((c) => this.grants.has(c));
  }

  private describe(cap: RunnableCapability): CapabilityDescriptor {
    return { ...cap.descriptor, available: this.available(cap) };
  }

  list(filter: CapabilityFilter = {}): CapabilityDescriptor[] {
    const out: CapabilityDescriptor[] = [];
    for (const cap of this.byId.values()) {
      const d = this.describe(cap);
      if (!filter.includeUnavailable && !d.available) continue;
      if (filter.category && d.category !== filter.category) continue;
      if (filter.kind && d.kind !== filter.kind) continue;
      if (filter.readOnly !== undefined && d.readOnly !== filter.readOnly) continue;
      out.push(d);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): CapabilityDescriptor | undefined {
    const cap = this.byId.get(id);
    return cap ? this.describe(cap) : undefined;
  }

  /** Internal: the runnable (schema + handler) for a capability, or undefined if
   * unknown. Availability is checked separately by the route. */
  runnable(id: string): { descriptor: CapabilityDescriptor; inputSchema: ZodType; handler: Handler; preview?: Handler } | undefined {
    const cap = this.byId.get(id);
    if (!cap) return undefined;
    return { descriptor: this.describe(cap), inputSchema: cap.inputSchema, handler: cap.handler, preview: cap.preview };
  }

  isAvailable(id: string): boolean {
    const cap = this.byId.get(id);
    return cap ? this.available(cap) : false;
  }
}
