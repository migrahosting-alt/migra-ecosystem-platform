#!/usr/bin/env node
/**
 * Reject `await` on a VS Code message API whose result is discarded.
 *
 * `showInformationMessage` and friends resolve when the notification is DISMISSED. Awaiting
 * one whose result nobody reads buys nothing and costs everything: the surrounding command
 * stays pending until the operator clicks the toast away, and a command that ignores it never
 * completes. Two of the first two commands audited carried this, in code written months
 * apart, so it is a pattern rather than an incident.
 *
 * The rule targets UNUSED AWAITED RESULTS, not the API. Banning `await` outright would break
 * the confirmation flows that are its legitimate use — and those are exactly the destructive
 * paths where an unawaited prompt would be a far worse defect than a hang:
 *
 *     const choice = await vscode.window.showWarningMessage('Delete?', { modal: true }, 'Delete');
 *
 * AST-based, not textual. A regex counting assignments on the same line misjudges multi-line
 * calls in both directions, and this check decides whether code is allowed to merge.
 */

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = join(HERE, '..');
const SRC = join(EXT_ROOT, 'src');
const OUT_DIR = join(SRC, 'interaction', 'generated');
const OUT_FILE = join(OUT_DIR, 'notification-awaits.generated.json');

const MESSAGE_APIS = new Set(['showInformationMessage', 'showWarningMessage', 'showErrorMessage']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Is this call one of the message APIs, on `vscode.window` or a `window` alias? */
function isMessageApiCall(node) {
  if (!ts.isCallExpression(node)) return undefined;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const method = callee.name.text;
  if (!MESSAGE_APIS.has(method)) return undefined;
  // `vscode.window.showX` or `window.showX` — the receiver must mention `window`, so an
  // unrelated `showErrorMessage` on some other object is not swept up.
  const receiver = callee.expression.getText();
  if (!/(^|\.)window$/.test(receiver.trim())) return undefined;
  return method;
}

/**
 * consumed | discarded | ambiguous.
 *
 * `ambiguous` is a real answer, not a fallback for laziness: an await in a position this
 * function does not recognise needs a human, and silently calling it consumed would let the
 * defect through while silently calling it discarded would break working code.
 */
function classify(awaitNode) {
  let node = awaitNode;
  let parent = node.parent;

  // Unwrap positions that neither use nor discard the value themselves.
  while (
    parent &&
    (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent))
  ) {
    node = parent;
    parent = node.parent;
  }
  if (!parent) return 'ambiguous';

  // `await show…()` alone on a line, or `void await show…()`.
  if (ts.isExpressionStatement(parent)) return 'discarded';
  if (ts.isVoidExpression(parent)) return 'discarded';

  // The result goes somewhere.
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) return 'consumed';
  if (ts.isBinaryExpression(parent)) return 'consumed';
  if (ts.isReturnStatement(parent)) return 'consumed';
  if (ts.isCallExpression(parent) && parent.arguments.includes(node)) return 'consumed';
  if (ts.isIfStatement(parent) && parent.expression === node) return 'consumed';
  if (ts.isConditionalExpression(parent)) return 'consumed';
  if (ts.isPropertyAssignment(parent)) return 'consumed';
  if (ts.isTemplateSpan(parent)) return 'consumed';
  if (ts.isArrowFunction(parent) && parent.body === node) return 'consumed';
  if (ts.isSwitchStatement(parent) && parent.expression === node) return 'consumed';
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return 'consumed';
  if (ts.isArrayLiteralExpression(parent)) return 'consumed';
  if (ts.isPrefixUnaryExpression(parent)) return 'consumed';

  return 'ambiguous';
}

const findings = [];
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, /* setParentNodes */ true);
  const rel = relative(EXT_ROOT, file);

  const visit = (node) => {
    if (ts.isAwaitExpression(node)) {
      const method = isMessageApiCall(node.expression);
      if (method) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        findings.push({
          file: rel,
          line: line + 1,
          api: method,
          classification: classify(node),
          // First line only: enough to identify the call without copying prose into an artifact.
          snippet: node.getText(source).split('\n')[0].slice(0, 120),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

const counts = findings.reduce(
  (acc, f) => ({ ...acc, [f.classification]: (acc[f.classification] ?? 0) + 1 }),
  { consumed: 0, discarded: 0, ambiguous: 0 },
);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  OUT_FILE,
  `${JSON.stringify(
    {
      generated: 'by scripts/check-notification-awaits.mjs — DERIVED EVIDENCE, do not edit',
      rule: 'await on a VS Code message API is prohibited when the result is discarded; permitted when consumed',
      counts,
      findings,
    },
    null,
    2,
  )}\n`,
);

const violations = findings.filter((f) => f.classification === 'discarded');
const ambiguous = findings.filter((f) => f.classification === 'ambiguous');

console.log(
  `notification awaits: ${findings.length} total — ${counts.consumed} consumed, ${counts.discarded} discarded, ${counts.ambiguous} ambiguous`,
);
console.log(`  → ${relative(EXT_ROOT, OUT_FILE)}`);

if (ambiguous.length > 0) {
  // Reported, never auto-resolved: an await in an unrecognised position needs a human.
  console.error('ambiguous awaited notification results — classify these explicitly:');
  for (const f of ambiguous) console.error(`  ? ${f.file}:${f.line}  ${f.snippet}`);
}
if (violations.length > 0) {
  console.error('awaited notification results that are DISCARDED (the command stays pending until dismissed):');
  for (const f of violations) console.error(`  ✗ ${f.file}:${f.line}  ${f.snippet}`);
  console.error('  fix: use `void vscode.window.show…Message(...)`, or consume the returned choice');
}
process.exit(violations.length > 0 || ambiguous.length > 0 ? 1 : 0);
