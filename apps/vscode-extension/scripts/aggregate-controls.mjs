#!/usr/bin/env node
/**
 * Build-time control aggregation and validation.
 *
 * Declarations live BESIDE the controls they describe (`*.control.ts`). This collects them
 * into a generated artifact and validates the set as a whole — the checks that only make
 * sense across declarations, like duplicate identities, cannot live in any one of them.
 *
 * THE GENERATED ARTIFACT IS DERIVED EVIDENCE, NOT THE SOURCE OF TRUTH. It is regenerated
 * from source on every build and must never be hand-edited; if it disagrees with the
 * declarations, the declarations win and the artifact is stale.
 *
 * Exit non-zero on any violation. A registry that tolerates a duplicate identity is worse
 * than no registry, because everything downstream trusts it to be unambiguous.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = join(HERE, '..');
const SRC = join(EXT_ROOT, 'src');
const OUT_DIR = join(SRC, 'interaction', 'generated');
const OUT_FILE = join(OUT_DIR, 'controls.generated.json');

/**
 * Commands contributed but not yet declared as controls.
 *
 * Every entry is a COVERAGE GAP, listed so it is visible rather than silently tolerated.
 * The check below fails for any contributed command that is neither declared nor listed
 * here, so adding a new command forces a decision instead of quietly widening the gap.
 */
const UNDECLARED_COMMANDS = new Set([
  'migrapilot.aiUsage',
  'migrapilot.clearToken',
  'migrapilot.dev.openClassicAgentMode',
  'migrapilot.dev.openClassicChat',
  'migrapilot.dev.openClassicWorkspace',
  'migrapilot.executionPolicy',
  'migrapilot.fixDiagnostics',
  'migrapilot.generateCommit',
  'migrapilot.generateTests',
  'migrapilot.health',
  'migrapilot.openAgentMode',
  'migrapilot.openChat',
  'migrapilot.openStudio',
  'migrapilot.openWorkspacePanel',
  'migrapilot.pairAgentMode',
  'migrapilot.productionDiagnostics',
  'migrapilot.providerStatus',
  'migrapilot.repairConnection',
  'migrapilot.reviewApprovals',
  'migrapilot.setToken',
  'migrapilot.showBackendDiagnostics',
  'migrapilot.showDiagnostics',
  'migrapilot.showLogs',
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.control.ts')) out.push(full);
  }
  return out;
}

/**
 * Read declarations without executing them.
 *
 * A `.control.ts` is a static object literal by contract, so it is parsed rather than
 * imported: importing would pull in `vscode` and make a build step depend on an editor host.
 */
function parseDeclaration(file) {
  const text = readFileSync(file, 'utf8');
  const field = (name) => {
    const m = new RegExp(`${name}\\s*:\\s*'([^']*)'`).exec(text);
    return m?.[1];
  };
  const num = (name) => {
    const m = new RegExp(`${name}\\s*:\\s*(\\d+)`).exec(text);
    return m ? Number(m[1]) : undefined;
  };
  return {
    file: relative(EXT_ROOT, file),
    applicationId: field('applicationId'),
    surfaceId: field('surfaceId'),
    controlId: field('controlId'),
    controlVersion: num('controlVersion'),
    instanceScope: field('instanceScope'),
    consequence: field('consequence'),
    locator: { adapter: field('adapter'), commandId: field('commandId'), confidence: field('confidence') },
  };
}

const CONSEQUENCES = ['read-only', 'mutating', 'approval', 'destructive'];
const SCOPES = ['global', 'window', 'workspace', 'session', 'document'];

const files = walk(SRC);
const declarations = files.map(parseDeclaration);
const errors = [];

const byIdentity = new Map();
const byCommand = new Map();

for (const d of declarations) {
  const where = d.file;

  for (const required of ['applicationId', 'surfaceId', 'controlId', 'instanceScope']) {
    if (!d[required]) errors.push(`${where}: missing ${required}`);
  }
  // Consequence classification is mandatory. An unclassified control cannot be safely
  // scheduled, because the runner would not know whether it may be invoked at all.
  if (!d.consequence) errors.push(`${where}: missing consequence classification`);
  else if (!CONSEQUENCES.includes(d.consequence)) errors.push(`${where}: unknown consequence "${d.consequence}"`);
  if (d.instanceScope && !SCOPES.includes(d.instanceScope)) errors.push(`${where}: unknown instanceScope "${d.instanceScope}"`);

  if (!Number.isInteger(d.controlVersion) || d.controlVersion < 1) {
    errors.push(`${where}: controlVersion must be a positive integer, got ${d.controlVersion}`);
  }

  const identity = `${d.applicationId}/${d.surfaceId}/${d.controlId}@v${d.controlVersion}`;
  if (byIdentity.has(identity)) errors.push(`duplicate identity ${identity} (${byIdentity.get(identity)} and ${where})`);
  else byIdentity.set(identity, where);

  if (d.locator.adapter === 'vscode-command') {
    if (!d.locator.commandId) errors.push(`${where}: vscode-command locator has no commandId`);
    else if (byCommand.has(d.locator.commandId)) {
      // Two identities on one command means an invocation cannot be attributed.
      errors.push(`duplicate exact command locator "${d.locator.commandId}" (${byCommand.get(d.locator.commandId)} and ${where})`);
    } else byCommand.set(d.locator.commandId, where);
  }
}

// Contributed commands with no declaration and no acknowledged gap.
const pkg = JSON.parse(readFileSync(join(EXT_ROOT, 'package.json'), 'utf8'));
const contributed = (pkg.contributes?.commands ?? []).map((c) => c.command);
for (const command of contributed) {
  if (byCommand.has(command) || UNDECLARED_COMMANDS.has(command)) continue;
  errors.push(
    `contributed command "${command}" has no control declaration and is not listed as a known gap — ` +
      'declare a control beside it, or add it to UNDECLARED_COMMANDS to record the gap explicitly',
  );
}
// A gap entry for a command that no longer exists is stale bookkeeping.
for (const stale of [...UNDECLARED_COMMANDS].filter((c) => !contributed.includes(c))) {
  errors.push(`UNDECLARED_COMMANDS lists "${stale}", which is no longer a contributed command`);
}

if (errors.length > 0) {
  console.error('control registry validation failed:');
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const artifact = {
  generated: 'by scripts/aggregate-controls.mjs — DERIVED EVIDENCE, do not edit',
  declarations: declarations.sort((a, b) => a.controlId.localeCompare(b.controlId)),
  coverage: {
    contributedCommands: contributed.length,
    declaredControls: declarations.length,
    knownGaps: [...UNDECLARED_COMMANDS].sort(),
  },
};
writeFileSync(OUT_FILE, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(
  `controls: ${declarations.length} declared, ${UNDECLARED_COMMANDS.size} known gaps of ${contributed.length} contributed commands`,
);
console.log(`  → ${relative(EXT_ROOT, OUT_FILE)}`);
