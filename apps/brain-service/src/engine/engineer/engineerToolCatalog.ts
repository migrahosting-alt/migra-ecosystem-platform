import type {
  CapabilityDescriptor,
  CapabilityRegistry,
} from '../models/capabilityRegistry.js';
import type { EngineerToolInfo } from './engineerRuntime.js';

export const ENGINEER_INPUT_HINTS: Record<string, string> = {
  'workspace.search': '{"rootPath","query"}',
  'workspace.list':
    '{"rootPath","path"?,"depth"?,"limit"?} — the ONLY way to see what files exist',
  'plan.update':
    '{"steps":["first","second",...]} to set a plan, {"complete":[1,2]} to tick steps off',
  'workspace.find':
    '{"rootPath","query","kind"?,"limit"?} — find files by NAME or glob',
  'file.read':
    '{"rootPath","path","maxBytes"?} — read a WHOLE file (no line numbers needed)',
  'file.readRange':
    '{"rootPath","path","startLine","endLine"}',
  'file.readSymbol':
    '{"rootPath","path","symbol"}',
  'git.status':
    '{"rootPath"}',
  'git.diff':
    '{"rootPath"}',
  'git.overview':
    '{"rootPath"}',
  'git.history':
    '{"rootPath","limit"?}',
  'git.blame':
    '{"rootPath","path","startLine"?,"endLine"?}',
  'diagnostics.get':
    '{"rootPath","path"?}',
  'edit.preview':
    '{"rootPath","changes":[{"path","startLine","endLine","replacement"}]}',
  'fs.proposeChangeset':
    '{"rootPath","ops":[{"op":"create","path":"src/x.js","content":"..."}]} (op: create|replace|patch|delete|mkdir)',
};

function descriptorToEngineerTool(
  d: CapabilityDescriptor,
): EngineerToolInfo {
  return {
    id: d.id,
    description: d.description,
    readOnly: d.readOnly,
    evidenceSemantics: d.evidenceSemantics,
    inputHint:
      ENGINEER_INPUT_HINTS[d.id] ??
      (d.id.startsWith('mcp.')
        ? '{ ...arguments for this tool; NO rootPath }'
        : '{"rootPath",...}'),
  };
}

export function buildEngineerLoopTools(
  registry: Pick<CapabilityRegistry, 'list'>,
  approvedOnly = false,
): EngineerToolInfo[] {
  const registryTools = approvedOnly
    ? []
    : registry
        .list({ includeUnavailable: false })
        .filter(
          (t) =>
            t.kind === 'tool' &&
            t.id !== 'edit.apply' &&
            t.readOnly,
        )
        .map(descriptorToEngineerTool);

  return [
    ...registryTools,
    {
      id: 'plan.update',
      description:
        'Record your plan for a multi-step task and tick steps off as you finish them.',
      readOnly: true,
      evidenceSemantics: [],
      inputHint: ENGINEER_INPUT_HINTS['plan.update']!,
    },
  ];
}
