// Sanity-check a proposed changeset for OBVIOUS defects before it can reach the
// user's files. Local models sometimes produce a botched whole-file edit — a
// duplicated function, leaked tool-call markup, a merge marker, broken JSON. The
// engineer feeds these defects back so the model self-corrects; the extension
// also warns before Apply. High-signal, near-zero-false-positive checks only —
// this is a safety net, not a compiler.

export interface ChangesetDefect {
  path: string;
  issue: string;
}

interface ChangeOp {
  op?: string;
  path?: string;
  content?: string | null;
}

const CODE_EXT = /\.(js|jsx|mjs|cjs|ts|tsx|py|go|rs|java|c|cc|cpp|h|hpp|cs|rb|php|swift|kt|scala)$/i;

/** Lint whole-file content ops (create/replace) for obvious breakage. Patch/
 * delete/mkdir ops carry no full content to check and are skipped. */
export function lintChangeset(ops: readonly ChangeOp[]): ChangesetDefect[] {
  const defects: ChangesetDefect[] = [];
  for (const op of ops) {
    const path = op.path;
    if (!path) continue;
    if (op.op !== 'create' && op.op !== 'replace') continue;
    const content = op.content;
    if (content == null) continue;

    // Empty content where a real file was intended.
    if (content.trim() === '') {
      defects.push({ path, issue: 'proposed content is empty' });
      continue;
    }
    // Merge-conflict markers — never valid in a finished file.
    if (/^(?:<{7}|={7}|>{7})/m.test(content)) {
      defects.push({ path, issue: 'contains merge-conflict markers (<<<<<<< / ======= / >>>>>>>)' });
    }
    // Leaked model/tool-call markup (a botched agentic turn).
    if (/<function\s*=|<parameter\s*=|<\/?tool_call>/i.test(content)) {
      defects.push({ path, issue: 'contains leaked tool-call markup (<function=…>)' });
    }
    // Broken JSON.
    if (/\.jsonc?$/i.test(path)) {
      try {
        JSON.parse(content);
      } catch {
        defects.push({ path, issue: 'is not valid JSON' });
      }
    }
    // Duplicate top-level definitions — the classic botched-edit signature
    // (a rename/patch that appended a corrected line instead of replacing).
    if (CODE_EXT.test(path)) {
      const counts = new Map<string, number>();
      const declRe = /^[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?(?:public[ \t]+|private[ \t]+|protected[ \t]+)?(?:async[ \t]+)?(?:function|class|def|func|interface|type)[ \t]+([A-Za-z_$][\w$]*)/gm;
      let m: RegExpExecArray | null;
      while ((m = declRe.exec(content)) !== null) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
      for (const [name, count] of counts) {
        if (count > 1) defects.push({ path, issue: `defines '${name}' ${count}× (duplicate/botched edit)` });
      }
    }
  }
  return defects;
}

/** One-line human summary of the defects, for a note or an Apply warning. */
export function summarizeDefects(defects: readonly ChangesetDefect[]): string {
  return defects.map((d) => `\`${d.path}\` ${d.issue}`).join('; ');
}
