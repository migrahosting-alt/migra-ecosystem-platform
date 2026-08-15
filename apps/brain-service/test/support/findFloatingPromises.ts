/**
 * Migration acceptance instrument — find DROPPED promises.
 *
 * A floating promise here is a call that returns a thenable and whose result is
 * discarded as a bare expression statement:
 *
 *     this.persistence.setIndexState(id, 'degraded', now);   // ← nothing awaits this
 *
 * `tsc` does NOT report these. That is the whole reason this file exists: the
 * sub-slice 2.5 sync→async migration typechecked at 0 and built green while
 * several severe defects sat in the tree unseen — a governed coding run that
 * reported COMPLETED after silently losing its plan, an approval that authorized
 * mutation after its durable write failed, a vector index whose memory advanced
 * past a commit the database rejected, and a server that began enforcing budgets
 * before it had hydrated what was already spent.
 *
 * ── CLOSURE CRITERION (owner-set) ───────────────────────────────────────────
 *
 * The migration is NOT complete when the count reaches zero. It is complete when
 * every remaining production hit is explicitly one of three things:
 *
 *   framework  — a known thenable/chaining API that is not a persistence write
 *   detached   — deliberately fire-and-forget, by contract
 *   accepted   — a real async dependency, awaited elsewhere, with reasoning
 *
 * Anything UNCATEGORIZED is open. Drive that number to zero, not the raw count.
 * Categorize a site with a comment on, or directly above, the statement:
 *
 *     // floating-ok: detached — swallowed by contract; surfaced through health
 *     void this.queue.flush();
 *
 * `framework` is applied automatically for the Fastify reply chain (below); the
 * other two must be written down by a human, because they are claims about
 * intent that a type checker cannot make.
 *
 * ── Reading an uncategorized hit ────────────────────────────────────────────
 *
 * Ask the invariant question: *can in-memory state, or a caller's return value,
 * outrun this write and claim something the durable record does not say?* If
 * yes, it is a defect regardless of whether a test currently fails on it.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   npx tsx test/support/findFloatingPromises.ts            # src/ only (default)
 *   npx tsx test/support/findFloatingPromises.ts --all      # include test/
 *   npx tsx test/support/findFloatingPromises.ts --json
 *   npx tsx test/support/findFloatingPromises.ts --open     # uncategorized only
 *
 * `test/` is excluded by default because `test(...)` from `node:test` itself
 * returns a promise: unfiltered output is ~1979 lines of noise against ~100 real
 * production hits. Filtering is what makes the signal usable. © MigraTeck LLC.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export type FloatingCategory = 'framework' | 'detached' | 'accepted' | 'open';

export interface FloatingPromise {
  file: string;
  line: number;
  text: string;
  category: FloatingCategory;
  /** Present when the category came from a `// floating-ok:` annotation. */
  reason?: string;
}

/**
 * Fastify's reply is THENABLE — it implements `then` so handlers can await it —
 * and its setters return the reply for chaining. So every `reply.code(400);`
 * trips a purely type-based check.
 *
 * These were 94 of 196 hits: nearly half the backlog was noise, and a reader who
 * has to filter that mentally every time will eventually filter out a real one.
 * The rule is deliberately NARROW — an exact receiver name AND an exact method
 * name — so it cannot hide a genuine persistence call.
 */
const FASTIFY_REPLY_RECEIVERS = new Set(['reply', 'res']);
const FASTIFY_REPLY_METHODS = new Set(['code', 'status', 'header', 'headers', 'type', 'send', 'hijack', 'redirect']);

function isFastifyReplyChain(call: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  if (!FASTIFY_REPLY_METHODS.has(call.expression.name.text)) return false;
  // Walk to the leftmost receiver so `reply.code(400).send(x)` still resolves.
  let node: ts.Expression = call.expression.expression;
  while (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node)) {
    node = ts.isCallExpression(node) ? node.expression : node.expression;
  }
  return ts.isIdentifier(node) && FASTIFY_REPLY_RECEIVERS.has(node.text);
}

const ANNOTATION = /floating-ok:\s*(detached|accepted|framework)\b[ \t]*(?:[—:-]\s*(.*))?/;

/** Read a `// floating-ok:` annotation from the statement's own line or the line above. */
function annotationFor(statement: ts.Node, sourceFile: ts.SourceFile): { category: FloatingCategory; reason?: string } | undefined {
  const text = sourceFile.text;
  const ranges = [
    ...(ts.getLeadingCommentRanges(text, statement.getFullStart()) ?? []),
    ...(ts.getTrailingCommentRanges(text, statement.end) ?? []),
  ];
  for (const range of ranges) {
    const match = ANNOTATION.exec(text.slice(range.pos, range.end));
    if (match) {
      const reason = match[2]?.trim();
      return { category: match[1] as FloatingCategory, ...(reason ? { reason } : {}) };
    }
  }
  return undefined;
}

/** True when a type carries a callable `then` — i.e. it is awaitable. */
function isThenable(type: ts.Type, checker: ts.TypeChecker): boolean {
  if (type.isUnionOrIntersection()) return type.types.some((t) => isThenable(t, checker));
  const then = type.getProperty('then');
  const declaration = then?.valueDeclaration ?? then?.declarations?.[0];
  if (!then || !declaration) return false;
  return checker.getTypeOfSymbolAtLocation(then, declaration).getCallSignatures().length > 0;
}

function scanSourceFile(sourceFile: ts.SourceFile, checker: ts.TypeChecker, displayName: string): FloatingPromise[] {
  const found: FloatingPromise[] = [];
  const visit = (node: ts.Node): void => {
    // The result is discarded exactly when the call IS the statement.
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression;
      if (isThenable(checker.getTypeAtLocation(call), checker)) {
        const annotated = annotationFor(node, sourceFile);
        const category: FloatingCategory = annotated?.category
          ?? (isFastifyReplyChain(call) ? 'framework' : 'open');
        const { line } = sourceFile.getLineAndCharacterOfPosition(call.getStart());
        found.push({
          file: displayName,
          line: line + 1,
          text: (call.getText().split('\n')[0] ?? '').slice(0, 110),
          category,
          ...(annotated?.reason ? { reason: annotated.reason } : {}),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

export function findFloatingPromises(projectDir: string, opts: { includeTests?: boolean } = {}): FloatingPromise[] {
  const configPath = ts.findConfigFile(projectDir, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) throw new Error(`no tsconfig.json found under ${projectDir}`);

  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    },
  });
  if (!parsed) throw new Error(`could not parse ${configPath}`);

  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  const found: FloatingPromise[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const rel = path.relative(projectDir, sourceFile.fileName);
    // Anything outside the package, generated, or vendored is not ours to fix.
    if (rel.startsWith('..') || rel.includes('node_modules') || rel.startsWith('dist')) continue;
    if (!opts.includeTests && !rel.startsWith('src' + path.sep)) continue;
    found.push(...scanSourceFile(sourceFile, checker, rel));
  }

  return found.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/**
 * Analyse a single in-memory source string. Exists so the detector's OWN rules
 * are testable — an acceptance instrument nobody verifies is just another
 * unchecked claim.
 */
export function findFloatingPromisesInSource(source: string, fileName = '/virtual/sample.ts'): FloatingPromise[] {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
    name === fileName
      ? ts.createSourceFile(name, source, languageVersion, true)
      : originalGetSourceFile(name, languageVersion, onError, shouldCreate);
  host.fileExists = (name) => name === fileName || ts.sys.fileExists(name);
  host.readFile = (name) => (name === fileName ? source : ts.sys.readFile(name));

  const program = ts.createProgram([fileName], options, host);
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) throw new Error('virtual source file was not created');
  return scanSourceFile(sourceFile, program.getTypeChecker(), fileName);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const includeTests = process.argv.includes('--all');
  const openOnly = process.argv.includes('--open');
  const all = findFloatingPromises(packageRoot, { includeTests });
  const results = openOnly ? all.filter((r) => r.category === 'open') : all;

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      const tag = r.category === 'open' ? '' : `  [${r.category}]`;
      console.log(`${r.file}:${r.line}${tag}  ${r.text}`);
    }
    const counts = new Map<FloatingCategory, number>();
    for (const r of all) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    const open = counts.get('open') ?? 0;
    console.log('');
    for (const c of ['open', 'framework', 'detached', 'accepted'] as const) {
      if (counts.get(c)) console.log(`${String(counts.get(c)).padStart(5)}  ${c}`);
    }
    console.log(`\nTOTAL ${all.length}${includeTests ? '' : ' in src/'} · UNCATEGORIZED (open): ${open}`);
    console.log(open === 0
      ? 'CLOSURE CRITERION MET — every hit is categorized.'
      : 'CLOSURE CRITERION NOT MET — categorize or fix the open hits above.');
  }
}
