/**
 * MigraAI Engine — RAG indexing exclusions.
 *
 * Fail-closed gatekeeper for what may enter a semantic index. NOTHING secret,
 * binary, or generated is ever indexed.
 *
 * ── PRECEDENCE (two tiers, deliberately not one flat list) ──────────────────
 *
 *  1. HARD exclusions — MigraAI secret/binary/generated list plus the explicit
 *     per-index list. These are ABSOLUTE: `.gitignore` cannot re-include them.
 *     A repository that says `!*` must still never index `.git`, `node_modules`,
 *     a `.env`, a database file, or build output.
 *
 *  2. `.gitignore` rules — ordered, with `!` negation and LAST MATCH WINS, which
 *     is the actual gitignore contract. Negations were previously dropped, so an
 *     allowlist-style `.gitignore` (ignore `*`, then re-include selected paths)
 *     excluded the entire repository and produced an empty index.
 *
 * Within tier 2 the bias is no longer "any match excludes": that is what broke
 * allowlists. Within tier 1 the bias remains absolute exclusion.
 *
 * ── EXCLUDED PARENTS WIN (verified against real `git check-ignore`) ─────────
 *
 * gitignore's decisive rule for allowlists: *a path cannot be re-included if any
 * ANCESTOR DIRECTORY is excluded.* Git stops at the excluded directory and never
 * looks inside, so a later negation cannot reach through it:
 *
 *   `*` + `!infra/nginx/**`                              → infra/nginx/nginx.conf IGNORED
 *   `*` + `!infra/` + `!infra/nginx/` + `!infra/nginx/**` → tracked
 *   `*` + `!src/` + `!src/**`                            → src/index.ts tracked,
 *                                                          but sub/src/app.ts IGNORED
 *
 * Evaluating each path against the flat rule list — without walking ancestors —
 * over-includes badly: on this repository it re-included 1,637 files that git
 * ignores, because `!.github/**` reached into excluded parents such as
 * `.archived-20260123/`. So {@link Exclusions.isExcluded} checks ancestors
 * top-down before the path's own rules.
 *
 * ── NESTED `.gitignore` FILES ───────────────────────────────────────────────
 *
 * A monorepo ignores most of its build output from PER-PACKAGE `.gitignore`
 * files, not the root one. Reading only the root file re-indexed 7 files git
 * ignores here (`apps/migrapilot-vscode/out.retired-hold/*.js`, ignored by
 * `apps/migrapilot-vscode/.gitignore:26`) — stale copies of a retired
 * extension's source, exactly the kind of duplicate that poisons retrieval.
 *
 * So rules are held as LAYERS keyed by the directory that owns them. A layer
 * applies only inside its own directory, and its patterns are relative to it.
 * Per git, a deeper file takes precedence over a shallower one, so layers are
 * evaluated shallow → deep and the deepest layer that matches decides.
 *
 * ── TRAVERSAL ───────────────────────────────────────────────────────────────
 *
 * Because an excluded directory can never contain a re-included descendant,
 * traversal needs no heuristic: {@link Exclusions.shouldDescend} is exactly
 * "this directory is not excluded" — which is precisely how git prunes.
 */

/** Secret-bearing paths — never indexed regardless of .gitignore. */
const SECRET_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.[^/]*)?$/i,
  /(^|\/)\.envrc$/i,
  /(^|\/)secrets?(\.[^/]*)?$/i,
  /\.(pem|key|pfx|p12|crt|cer|der|keystore|jks)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)credentials?(\.[^/]*)?$/i,
  /(^|\/)service-account.*\.json$/i,
  /(^|\/)\.aws\//i,
  /(^|\/)\.ssh\//i,
  /(^|\/)\.gnupg\//i,
  /\.(sql|dump|bak|sqlite|sqlite3|db)$/i, // database dumps/files
];

/** Binary / non-text extensions. */
/*
 * `pdf` is deliberately ABSENT from this list.
 *
 * A PDF is binary on disk, and treating it as binary was correct while nothing
 * could read one. It is now extracted to text before it reaches the indexer, so
 * excluding it here would refuse a document the pipeline can genuinely answer
 * from. Every other entry stays: they are still unreadable, and the exclusion is
 * what keeps them from being indexed as mojibake.
 */
const BINARY_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|svg|zip|gz|tar|tgz|7z|rar|exe|dll|so|dylib|bin|wasm|woff2?|ttf|otf|eot|mp[34]|mov|avi|mkv|class|jar|node|onnx|gguf|safetensors|pt|pth|ckpt)$/i;

/** Generated / vendored / build directories — excluded by default. */
/* Derived OCR text, written beside the uploads. Indexed VIA the PDF it belongs
 * to, never as a document of its own — otherwise every scanned page would be
 * retrievable twice, once under the book's name and once under a filename the
 * user never created. */
const OCR_SIDECAR = /(^|\/)\.migrapilot-ocr(\/|$)/;

const GENERATED_DIR = /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.turbo|\.cache|\.git|vendor|__pycache__|\.venv|venv|target|\.gradle|\.idea|\.vscode-test)(\/|$)/;
const GENERATED_FILE = /(\.min\.(js|css)|\.map|\.lock|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.tsbuildinfo|\.d\.ts)$/i;

export interface ExclusionConfig {
  /** Additional glob-ish substrings/regex sources to exclude (MigraAI list). */
  extra?: string[];
  /** Raw .gitignore contents (line-per-pattern). */
  gitignore?: string;
}

/** One parsed `.gitignore` line. */
interface GitignoreRule {
  re: RegExp;
  /** `!pattern` — re-includes rather than excludes. */
  negated: boolean;
  /** `pattern/` — matches a directory (and its contents), never a plain file. */
  dirOnly: boolean;
  /** Rooted at the repo (leading `/`, or a slash anywhere but the end). */
  anchored: boolean;
  /** Literal path text before the first wildcard — used for traversal only. */
  literalPrefix: string;
  /** Original line, for diagnostics. */
  source: string;
}

/** Workspace-relative, forward slashes, no leading/trailing slash. */
function normalize(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

export class Exclusions {
  /**
   * `.gitignore` rules by owning directory (`''` = repository root). Each list is
   * ordered — last match wins within a layer; deeper layers win across layers.
   */
  private readonly layers = new Map<string, GitignoreRule[]>();
  private readonly extra: RegExp[];
  /** Memoized directory verdicts — ancestors are re-tested for every path. */
  private readonly dirVerdicts = new Map<string, boolean>();

  constructor(cfg: ExclusionConfig = {}) {
    this.layers.set('', parseGitignore(cfg.gitignore ?? ''));
    this.extra = (cfg.extra ?? [])
      .map((s) => {
        try {
          return new RegExp(s);
        } catch {
          return parseGitignoreLine(s)?.re ?? null;
        }
      })
      .filter((r): r is RegExp => r !== null);
  }

  /**
   * Register a nested `.gitignore` found at `dirRelPath` during the walk.
   *
   * MUST be called before any path inside that directory is tested: directory
   * verdicts are memoized, and a layer registered late would not be applied to
   * an already-decided descendant. The walker reads a directory's `.gitignore`
   * immediately after `readdir`, before filtering or descending, which satisfies
   * this. A directory's own file can never exclude that directory itself (git
   * applies a `.gitignore` to its directory's *contents*), so no earlier verdict
   * is invalidated.
   */
  addNested(dirRelPath: string, gitignoreText: string): void {
    const base = normalize(dirRelPath);
    if (!base) return; // the root layer is set in the constructor
    const rules = parseGitignore(gitignoreText);
    if (rules.length === 0) return;
    const existing = this.layers.get(base);
    if (existing) existing.push(...rules);
    else this.layers.set(base, rules);
  }

  /**
   * True when `relPath` must NOT be indexed.
   *
   * `isDirectory` lets a directory-only pattern (`build/`) match a directory
   * without also matching a FILE of the same name.
   */
  isExcluded(relPath: string, isDirectory = false): boolean {
    const p = normalize(relPath);
    if (!p) return false;
    if (this.hardExcluded(p)) return true;
    // Ancestors FIRST: an excluded directory can never be re-opened by a later
    // negation, so a path inside one is excluded no matter what matches it.
    const segments = p.split('/');
    for (let i = 0; i < segments.length - 1; i += 1) {
      if (this.directoryExcluded(segments.slice(0, i + 1).join('/'))) return true;
    }
    return this.gitignoreExcludes(p, isDirectory);
  }

  /** Verdict for a directory path, memoized (ancestors repeat constantly). */
  private directoryExcluded(dir: string): boolean {
    const cached = this.dirVerdicts.get(dir);
    if (cached !== undefined) return cached;
    const verdict = this.hardExcluded(dir) || this.gitignoreExcludes(dir, true);
    this.dirVerdicts.set(dir, verdict);
    return verdict;
  }

  /**
   * May the walk enter this directory?
   *
   * Exactly "the directory is not excluded" — no heuristic needed, because git
   * cannot re-include through an excluded parent. Ancestors are consulted too, so
   * a nested directory under an excluded one is never entered.
   */
  shouldDescend(dirRelPath: string): boolean {
    const p = normalize(dirRelPath);
    if (!p) return true; // the root itself
    return !this.isExcluded(p, true);
  }

  /** Reason a path is excluded (diagnostics; never the file content). */
  reason(relPath: string, isDirectory = false): string | null {
    const p = normalize(relPath);
    if (SECRET_PATTERNS.some((re) => re.test(p))) return 'secret';
    if (BINARY_EXT.test(p)) return 'binary';
    if (OCR_SIDECAR.test(p)) return 'generated';
    if (GENERATED_DIR.test(p) || GENERATED_FILE.test(p)) return 'generated';
    if (this.extra.some((re) => re.test(p))) return 'exclusion-list';
    if (this.gitignoreExcludes(p, isDirectory)) return 'gitignore';
    // Distinguish "this path matched an ignore rule" from "an ancestor did" —
    // the fix for an excluded ancestor is a different .gitignore edit.
    return this.isExcluded(p, isDirectory) ? 'excluded-parent' : null;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Tier 1: absolute. A `.gitignore` negation can never override these. */
  private hardExcluded(p: string): boolean {
    if (SECRET_PATTERNS.some((re) => re.test(p))) return true;
    if (BINARY_EXT.test(p)) return true;
    if (OCR_SIDECAR.test(p)) return true;
    if (GENERATED_DIR.test(p) || GENERATED_FILE.test(p)) return true;
    if (this.extra.some((re) => re.test(p))) return true;
    return false;
  }

  /**
   * Tier 2: ordered `.gitignore` evaluation, LAST matching rule wins.
   *
   * Each pattern matches the path ITSELF, never its descendants. Excluding a
   * directory still excludes everything under it — but via the ancestor walk in
   * {@link isExcluded}, not by widening the regex. That distinction matters for
   * NEGATIONS: `!apps/` re-opens the directory `apps` so the walk may enter it,
   * and must NOT re-include `apps/anything`. A descendant-matching regex made
   * `!/apps/` resurrect every file under apps/ — 2,555 paths git ignores.
   */
  private gitignoreExcludes(p: string, isDirectory: boolean): boolean {
    let excluded = false;
    // Shallow → deep, so a per-package `.gitignore` overrides the root one.
    for (const [base, rules] of this.applicableLayers(p)) {
      const scoped = base ? p.slice(base.length + 1) : p;
      for (const rule of rules) {
        // A directory-only pattern never matches a plain file.
        if (rule.dirOnly && !isDirectory) continue;
        if (rule.re.test(scoped)) excluded = !rule.negated;
      }
    }
    return excluded;
  }

  /** Root layer plus every ancestor directory that owns one, shallowest first. */
  private applicableLayers(p: string): Array<[string, GitignoreRule[]]> {
    const out: Array<[string, GitignoreRule[]]> = [['', this.layers.get('') ?? []]];
    if (this.layers.size === 1) return out; // common case: root only
    const segments = p.split('/');
    for (let i = 0; i < segments.length - 1; i += 1) {
      const base = segments.slice(0, i + 1).join('/');
      const rules = this.layers.get(base);
      if (rules) out.push([base, rules]);
    }
    return out;
  }

}

function parseGitignore(text: string): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const line of text.split(/\r?\n/)) {
    const rule = parseGitignoreLine(line);
    if (rule) rules.push(rule);
  }
  return rules;
}

/** Translate one `.gitignore` line into a rule (conservative, but negation-aware). */
function parseGitignoreLine(line: string): GitignoreRule | null {
  const source = line;
  let t = line.trim();
  if (!t || t.startsWith('#')) return null;

  const negated = t.startsWith('!');
  if (negated) t = t.slice(1).trim();
  if (!t) return null;

  const leadingSlash = t.startsWith('/');
  let body = leadingSlash ? t.slice(1) : t;
  const dirOnly = body.endsWith('/');
  if (dirOnly) body = body.replace(/\/+$/, '');
  if (!body) return null;

  // gitignore: a pattern containing a slash anywhere but the end is rooted.
  const anchored = leadingSlash || body.includes('/');

  // `**` is parked on a placeholder so the single-`*` pass cannot chew it up,
  // then expanded. The previous implementation parked it on a SPACE, which
  // corrupted any pattern containing a literal space. The placeholder is written
  // as a JS escape sequence, never as a raw NUL byte in this source: a raw one
  // makes this very file read as binary and silently drops it from its own index.
  const escaped = body
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '[^/]');

  const prefix = anchored ? '^' : '(^|/)';
  // Anchored to the END of the path: a pattern describes the path it names, not
  // its subtree. Subtree exclusion comes from the ancestor walk; subtree
  // RE-inclusion must be written explicitly (`!dir/` plus `!dir/**`), exactly as
  // git requires.
  const suffix = '$';

  const wildcardAt = body.search(/[*?[]/);
  const literalPrefix = wildcardAt === -1 ? body : body.slice(0, wildcardAt);

  try {
    return { re: new RegExp(`${prefix}${escaped}${suffix}`), negated, dirOnly, anchored, literalPrefix, source };
  } catch {
    return null;
  }
}

export const DEFAULT_MIGRAAI_EXCLUSIONS = [
  '(^|/)model-qualification\\.json$',
  '(^|/)\\.migra(/|$)',
  '(^|/)eval/results(/|$)',
];
